// nfeControllerNodeNfe.js
const { NFe, AMBIENTE_HOMOLOGACAO } = require('node-nfe');
const supabase = require('./supabaseClient');
const { gerarXmlNfe } = require('./xmlBuilder');
const { assinarXml } = require('./xmlSigner');
const { loadCertificates } = require('./utils');
const NFEService = require('./nfeService');

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

        // Prepara os dados para o XML (reutilizando o xmlBuilder original)
        const isMesmaUF = (cliente.uf === 'PR');
        const cfopFinal = cfop || (isMesmaUF ? '5102' : '6108');

        let documento = (cliente.documento || '').replace(/\D/g, '');
        if (!documento || (documento.length !== 11 && documento.length !== 14)) {
            console.warn('⚠️ Documento inválido, usando CPF genérico para homologação');
            documento = '99999999999';
        }
        const tipoDoc = documento.length === 14 ? 'CNPJ' : 'CPF';

        const destinatario = {
            xNome: cliente.nome || 'Consumidor Final',
            xLgr: cliente.endereco || cliente.logradouro || 'NÃO INFORMADO',
            nro: cliente.numero || 'S/N',
            xBairro: cliente.bairro || 'CENTRO',
            xMun: cliente.cidade || 'ARAUCARIA',
            UF: cliente.uf || 'PR',
            CEP: (cliente.cep || '83702090').replace(/\D/g, ''),
            cMun: cliente.codigo_ibge || 4101804
        };
        if (tipoDoc === 'CPF') {
            destinatario.CPF = documento;
        } else {
            destinatario.CNPJ = documento;
        }

        const valorTotal = produtos.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0);

        // Gera o XML usando o builder original (já testado)
        const xml = gerarXmlNfe({
            nNF,
            serie: 1,
            destinatario,
            produtos,
            cfop: cfopFinal,
            natOp: natureza_operacao || 'VENDA',
            modFrete: modalidade_frete || '9',
            valor_total: valorTotal
        });

        // Assina o XML com o certificado (já testado)
        const certData = loadCertificates();
        const xmlAssinado = assinarXml(xml, { privateKey: certData.privateKey, cert: certData.cert });

        // Tenta enviar via node-nfe primeiro, se falhar usa o NFEService antigo
        let respostaSefaz;
        try {
            // Tenta usar o método de envio da node-nfe (se existir)
            const pfxBase64 = process.env.PFX_BASE64;
            const pfxPassword = process.env.PFX_PASSWORD;
            const pfxBuffer = Buffer.from(pfxBase64, 'base64');

            const nfe = new NFe({
                ambiente: AMBIENTE_HOMOLOGACAO,
                certificado: {
                    pfx: pfxBuffer,
                    senha: pfxPassword
                }
            });

            // Verifica se existe o método 'enviar'
            if (typeof nfe.enviar === 'function') {
                respostaSefaz = await nfe.enviar(xmlAssinado);
            } else {
                throw new Error('Método enviar não encontrado na node-nfe');
            }
        } catch (nodeNfeError) {
            console.warn('⚠️ Falha ao usar node-nfe, caindo para NFEService manual:', nodeNfeError.message);
            // Fallback: usa o NFEService que já existe
            const nfeService = new NFEService('homologacao');
            respostaSefaz = await nfeService.sendNFe(xmlAssinado, certData);
        }

        // Extrai protocolo e chave
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

        // Salva no Supabase
        await supabase.from('nfe_emitidas').insert({
            venda_id: venda_id || null,
            chave: chaveAcesso,
            protocolo: protocolo,
            xml: xmlAssinado,
            status: 'autorizada',
            cancelada: false,
            data_emissao: new Date().toISOString(),
            valor_total: valorTotal
        });

        if (venda_id) {
            await supabase
                .from('vendas_ml')
                .update({
                    nfe_emitida: true,
                    nfe_chave: chaveAcesso,
                    nfe_protocolo: protocolo,
                    data_emissao: new Date().toISOString()
                })
                .eq('id', venda_id);
        }

        res.json({ success: true, protocolo, chaveAcesso });

    } catch (error) {
        console.error('❌ Erro na emissão:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = { emitirNFe };