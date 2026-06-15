const { gerarXmlNfe } = require('./xmlBuilder');
const { assinarXml } = require('./xmlSigner');
const { loadCertificates } = require('./utils');
const supabase = require('./supabaseClient');
const https = require('https');
const fs = require('fs');

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
    try {
        const { cliente, produtos, cfop, natureza_operacao, modalidade_frete, venda_id } = req.body;
        if (!cliente || !produtos || produtos.length === 0) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        const nNF = await getNextNFNumber();
        console.log(`✅ Número NF alocado: ${nNF}`);

        // Dados do destinatário (com código IBGE)
        const cidade = cliente.cidade || 'Aracaju';
        const uf = cliente.uf || 'SE';
        const codigoIbge = cliente.codigo_ibge || (uf === 'SE' ? '2800308' : '4101804');

        const destinatario = {
            CPF: cliente.documento.replace(/\D/g, ''),
            xNome: cliente.nome,
            xLgr: cliente.endereco,
            nro: cliente.numero || 'S/N',
            xBairro: cliente.bairro || 'Centro',
            xMun: cidade,
            UF: uf,
            CEP: cliente.cep.replace(/\D/g, ''),
            cMun: codigoIbge
        };

        const isMesmaUF = (uf === 'PR');
        const cfopFinal = cfop || (isMesmaUF ? '5102' : '6108');
        const valorTotal = produtos.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0);

        // Gera o XML usando seu builder (já ajustado para produção)
        const xml = gerarXmlNfe({
            nNF,
            serie: 1,
            destinatario,
            produtos,
            cfop: cfopFinal,
            natOp: natureza_operacao || 'Venda',
            modFrete: modalidade_frete || '2',
            valor_total: valorTotal
        });

        // Assina o XML
        const certData = loadCertificates();
        const xmlAssinado = assinarXml(xml, certData);

        // Prepara o envelope SOAP (sem quebras de linha extras)
        const xmlLimpo = xmlAssinado
            .replace(/<\?xml.*?\?>/g, '')
            .replace(/\r?\n/g, '')
            .replace(/\t/g, '')
            .replace(/>\s+</g, '><')
            .trim();

        const envelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${xmlLimpo}</nfeDadosMsg></soap:Body></soap:Envelope>`;

        // Salva o envelope para depuração (opcional)
        fs.writeFileSync('/tmp/ultimo_envelope.xml', envelope);
        console.log('📄 Envelope salvo em /tmp/ultimo_envelope.xml');

        // Configura a requisição HTTPS
        const options = {
            hostname: 'nfe.sefa.pr.gov.br',
            path: '/nfe/NFeAutorizacao4',
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeDadosMsg',
                'Content-Length': Buffer.byteLength(envelope)
            },
            cert: certData.cert,
            key: certData.privateKey,
            ca: certData.ca,
            rejectUnauthorized: false,
            secureProtocol: 'TLSv1_2_method'
        };

        // Envia
        const responseData = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
            req.write(envelope);
            req.end();
        });

        // Processa a resposta
        const cStatMatch = responseData.match(/<cStat>(\d+)<\/cStat>/);
        const xMotivoMatch = responseData.match(/<xMotivo>([^<]+)<\/xMotivo>/);
        const protocoloMatch = responseData.match(/<nProt>(\d+)<\/nProt>/);
        const chaveMatch = responseData.match(/<chNFe>([^<]+)<\/chNFe>/);

        if (!cStatMatch || cStatMatch[1] !== '100') {
            throw new Error(`SEFAZ rejeitou: ${xMotivoMatch?.[1] || 'Erro desconhecido'} (cStat=${cStatMatch?.[1] || '?'})`);
        }

        const protocolo = protocoloMatch[1];
        const chaveAcesso = chaveMatch ? chaveMatch[1] : null;

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
            await supabase.from('vendas_ml').update({
                nfe_emitida: true,
                nfe_chave: chaveAcesso,
                nfe_protocolo: protocolo,
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