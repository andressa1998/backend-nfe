const { gerarXmlNfe } = require('./xmlBuilder');
const { assinarXml } = require('./xmlSigner');
const { loadCertificates } = require('./utils');
const NFEService = require('./nfeService');
const supabase = require('./supabaseClient');
const fs = require('fs');

const DEFAULT_IBGE = '4101804';

async function obterCodigoMunicipio(nomeCidade, uf, cep = null) {
    try {
        const { data, error } = await supabase
            .from('municipios')
            .select('codigo_ibge')
            .ilike('nome', nomeCidade.trim())
            .eq('uf', uf)
            .maybeSingle();
        if (data && !error && data.codigo_ibge) {
            return String(data.codigo_ibge);
        }
        if (cep) {
            const fetch = require('node-fetch');
            const cepLimpo = cep.replace(/\D/g, '');
            const response = await fetch(`https://brasilapi.com.br/api/cep/v1/${cepLimpo}`);
            if (response.ok) {
                const json = await response.json();
                if (json.ibge_code) {
                    const ibge = String(json.ibge_code);
                    await supabase.from('municipios').upsert({
                        codigo_ibge: parseInt(ibge),
                        nome: json.city,
                        uf: json.state
                    }, { onConflict: 'codigo_ibge' });
                    return ibge;
                }
            }
        }
        console.warn(`⚠️ IBGE não encontrado para ${nomeCidade}/${uf}, usando padrão ${DEFAULT_IBGE}`);
        return DEFAULT_IBGE;
    } catch (error) {
        console.error('❌ Erro ao obter IBGE:', error);
        return DEFAULT_IBGE;
    }
}

async function getNextNFNumber(serie = 1) {
    try {
        const { data, error } = await supabase
            .from('controle_nfe')
            .select('ultimo_numero')
            .eq('serie', serie)
            .maybeSingle();
        const proximo = (data?.ultimo_numero || 50000) + 1;
        await supabase
            .from('controle_nfe')
            .upsert({ serie, ultimo_numero: proximo }, { onConflict: 'serie' });
        return proximo;
    } catch (error) {
        console.error('Erro ao obter próximo número NF:', error);
        return Math.floor(Math.random() * 900000000) + 100000000;
    }
}

async function emitirNFe(req, res) {
    console.log('📨 [node-nfe] Requisição de emissão recebida');
    try {
        const { cliente, produtos, cfop, natureza_operacao, modalidade_frete, venda_id } = req.body;
        if (!cliente || !produtos || produtos.length === 0) {
            return res.status(400).json({ error: 'Dados incompletos: cliente e produtos são obrigatórios' });
        }

        const nNF = await getNextNFNumber();
        console.log(`✅ Número NF alocado: ${nNF}`);

        let documento = (cliente.documento || '').replace(/\D/g, '');
        if (!documento || (documento.length !== 11 && documento.length !== 14)) {
            console.warn('⚠️ Documento inválido, usando CPF genérico para homologação');
            documento = '99999999999';
        }
        const tipoDoc = documento.length === 14 ? 'CNPJ' : 'CPF';

        const cidade = cliente.cidade || 'ARAUCARIA';
        const uf = cliente.uf || 'PR';
        const cep = (cliente.cep || '83702090').replace(/\D/g, '');
        const codigoIbge = await obterCodigoMunicipio(cidade, uf, cep);
        console.log(`📍 Cidade: ${cidade}/${uf}, IBGE: ${codigoIbge}`);

        const destinatario = {
            xNome: cliente.nome || 'Consumidor Final',
            xLgr: cliente.endereco || cliente.logradouro || 'NÃO INFORMADO',
            nro: cliente.numero || 'S/N',
            xBairro: cliente.bairro || 'CENTRO',
            xMun: cidade,
            UF: uf,
            CEP: cep,
            cMun: codigoIbge
        };
        if (tipoDoc === 'CPF') {
            destinatario.CPF = documento;
        } else {
            destinatario.CNPJ = documento;
        }

        const isMesmaUF = (destinatario.UF === 'PR');
        const cfopFinal = cfop || (isMesmaUF ? '5102' : '6108');
        const valorTotal = produtos.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0);

        const xml = gerarXmlNfe({
            nNF, serie: 1, destinatario, produtos, cfop: cfopFinal,
            natOp: natureza_operacao || 'VENDA', modFrete: modalidade_frete || '9', valor_total: valorTotal
        });

        const certData = loadCertificates();
        const xmlAssinado = assinarXml(xml, { privateKey: certData.privateKey, cert: certData.cert });

        // Salva o XML para teste
        const xmlPath = '/tmp/nfe_enviada.xml';
        fs.writeFileSync(xmlPath, xmlAssinado);
        console.log(`📄 XML salvo em ${xmlPath}`);

        const nfeService = new NFEService('homologacao');
        const respostaSefaz = await nfeService.sendNFe(xmlAssinado, certData);

        const protocoloMatch = respostaSefaz.match(/<nProt[^>]*>(\d+)<\/nProt>/i);
        const cStatMatch = respostaSefaz.match(/<cStat[^>]*>(\d+)<\/cStat>/i);
        const xMotivoMatch = respostaSefaz.match(/<xMotivo[^>]*>([^<]+)<\/xMotivo>/i);

        if (!protocoloMatch || cStatMatch?.[1] !== '100') {
            throw new Error(`SEFAZ rejeitou: ${xMotivoMatch?.[1] || 'Erro desconhecido'} (cStat=${cStatMatch?.[1] || '?'})`);
        }

        const protocolo = protocoloMatch[1];
        const chaveMatch = xmlAssinado.match(/Id="NFe([0-9]{44})"/);
        const chaveAcesso = chaveMatch ? chaveMatch[1] : null;

        console.log(`✅ NF-e autorizada! Protocolo: ${protocolo}, Chave: ${chaveAcesso}`);

        await supabase.from('nfe_emitidas').insert({
            venda_id: venda_id || null, chave: chaveAcesso, protocolo: protocolo,
            xml: xmlAssinado, status: 'autorizada', cancelada: false,
            data_emissao: new Date().toISOString(), valor_total: valorTotal
        });

        if (venda_id) {
            await supabase.from('vendas_ml').update({
                nfe_emitida: true, nfe_chave: chaveAcesso, nfe_protocolo: protocolo,
                data_emissao: new Date().toISOString()
            }).eq('id', venda_id);
        }

        res.json({ success: true, protocolo, chaveAcesso });
    } catch (error) {
        console.error('❌ Erro na emissão:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = { emitirNFe };