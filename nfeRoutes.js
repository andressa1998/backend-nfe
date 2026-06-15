const express = require('express');
const fs = require('fs');
const https = require('https');
const axios = require('axios');

// Controladores
const { emitirNFe } = require('./nfeControllerNodeNfe');
const {
    cancelarNFe,
    listarNFesEmitidas,
    listarTransportadoras,
    cadastrarTransportadora,
    listarClientes,
    emitirNFEAvulsa,
    consultarStatusNFE,
    sincronizarVendasML,
    listarVendasSemNFE,
    listarVendasComNFE,
    buscarXMLPorChave,
    testarEnvioXMLFixo
} = require('./nfeController');

// Utilitários
const { loadCertificates } = require('./utils');
const { gerarXmlNfe } = require('./xmlBuilder');
const { assinarXml } = require('./xmlSigner');

const router = express.Router();

// ===================== ROTAS PRINCIPAIS =====================
router.post('/emitir', emitirNFe);
router.post('/cancelar', cancelarNFe);
router.get('/listar-nfes', listarNFesEmitidas);
router.get('/transportadoras', listarTransportadoras);
router.post('/transportadoras', cadastrarTransportadora);
router.get('/clientes', listarClientes);
router.post('/emitir-avulsa', emitirNFEAvulsa);
router.post('/consultar-status', consultarStatusNFE);
router.post('/sync-vendas', sincronizarVendasML);
router.get('/vendas-sem-nfe', listarVendasSemNFE);
router.get('/vendas-com-nfe', listarVendasComNFE);
router.get('/buscar-xml', buscarXMLPorChave);
router.post('/testar-xml-fixo', testarEnvioXMLFixo);

// ===================== ROTA PARA GERAR XML DE TESTE (COMPARAR COM O QUE FUNCIONA) =====================
router.post('/gerar-xml-teste', async (req, res) => {
    try {
        // Dados fixos do cliente que já teve NF-e autorizada (Saulo Luiz)
        const dados = {
            nNF: 50039,
            serie: 1,
            destinatario: {
                CPF: '04371412505',
                xNome: 'Saulo Luiz Silva Santos',
                xLgr: 'Rua Goias',
                nro: '1255',
                xBairro: 'Siqueira Campos',
                xMun: 'Aracaju',
                UF: 'SE',
                CEP: '49075280',
                cMun: '2800308'   // Código IBGE de Aracaju/SE
            },
            produtos: [{
                nome: 'Eixo Passante P/ Garfo C/ Cubo Dianteiro 15 X 100 P/ Fox 32',
                quantidade: 1,
                valor_unitario: 236.49,
                sku: '239EPDI12T145P1500',
                ncm: '87149990'
            }],
            cfop: '6108',
            natOp: 'Venda',
            modFrete: '2',
            venda_id: 'MLB123456'
        };

        const certData = loadCertificates();
        const xml = gerarXmlNfe(dados);
        const xmlAssinado = assinarXml(xml, certData);

        // Salva o XML no servidor
        const filePath = '/tmp/xml_gerado_teste.xml';
        fs.writeFileSync(filePath, xmlAssinado, 'utf8');

        // Retorna o XML para download (ou visualização)
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Disposition', 'attachment; filename="xml_gerado_teste.xml"');
        res.send(xmlAssinado);
    } catch (error) {
        console.error('Erro em /gerar-xml-teste:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===================== ROTA DE TESTE COM HTTPS NATIVO (ENVELOPE SOAP) =====================
router.post('/testar-soap-backend', async (req, res) => {
    try {
        console.log('📨 [testar-soap-backend] Iniciando...');
        const certData = loadCertificates();

        const dados = {
            nNF: 50038,
            serie: 1,
            destinatario: {
                CPF: '47840605885',
                xNome: 'Andressa Miotto',
                xLgr: 'Rua Jardineira',
                nro: '156',
                xBairro: 'Campina da Barra',
                xMun: 'ARAUCARIA',
                UF: 'PR',
                CEP: '83709310',
                cMun: '4101804'
            },
            produtos: [{
                nome: 'Bicicleta Aro 29',
                quantidade: 1,
                valor_unitario: 150.00,
                sku: 'MLB123456'
            }],
            cfop: '5102',
            natOp: 'VENDA',
            modFrete: '9'
        };

        const xml = gerarXmlNfe(dados);
        const xmlAssinado = assinarXml(xml, certData);
        const xmlLimpo = xmlAssinado
            .replace(/<\?xml.*?\?>/g, '')
            .replace(/\r?\n/g, '')
            .replace(/\t/g, '')
            .replace(/>\s+</g, '><')
            .trim();

        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${xmlLimpo}</nfeDadosMsg></soap:Body></soap:Envelope>`;

        const urlObj = new URL('https://nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4');
        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeDadosMsg',
                'Content-Length': Buffer.byteLength(soapEnvelope)
            },
            cert: certData.cert,
            key: certData.privateKey,
            ca: certData.ca || undefined,
            rejectUnauthorized: false,
            secureProtocol: 'TLSv1_2_method'
        };

        const responseData = await new Promise((resolve, reject) => {
            const request = https.request(options, (response) => {
                let data = '';
                response.on('data', chunk => data += chunk);
                response.on('end', () => resolve(data));
            });
            request.on('error', reject);
            request.write(soapEnvelope);
            request.end();
        });

        const cStatMatch = responseData.match(/<cStat>(\d+)<\/cStat>/);
        const xMotivoMatch = responseData.match(/<xMotivo>([^<]+)<\/xMotivo>/);
        const protocoloMatch = responseData.match(/<nProt>(\d+)<\/nProt>/);

        res.json({
            cStat: cStatMatch ? cStatMatch[1] : null,
            xMotivo: xMotivoMatch ? xMotivoMatch[1] : null,
            protocolo: protocoloMatch ? protocoloMatch[1] : null,
            resposta_completa: responseData.substring(0, 2000)
        });
    } catch (error) {
        console.error('Erro em /testar-soap-backend:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===================== ROTA PARA BAIXAR O ÚLTIMO XML GERADO =====================
router.get('/ultimo-xml', (req, res) => {
    const xmlPath = '/tmp/nfe_enviada.xml';
    if (fs.existsSync(xmlPath)) {
        const xml = fs.readFileSync(xmlPath, 'utf8');
        res.setHeader('Content-Type', 'application/xml');
        res.send(xml);
    } else {
        res.status(404).send('Nenhum XML gerado ainda. Tente emitir uma NF-e primeiro.');
    }
});

module.exports = router;