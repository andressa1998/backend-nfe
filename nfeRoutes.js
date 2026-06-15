const express = require('express');
const fs = require('fs');
const https = require('https');
const axios = require('axios');
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
const { loadCertificates } = require('./utils');
const { gerarXmlNfe } = require('./xmlBuilder');
const { assinarXml } = require('./xmlSigner');

const router = express.Router();

// Rotas principais
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

// 🔥 ROTA DE TESTE: ENVIA ENVELOPE SOAP DIRETAMENTE PARA A SEFAZ (usando certificado do backend)
router.post('/testar-soap-backend', async (req, res) => {
    try {
        console.log('📨 [testar-soap-backend] Iniciando...');
        const certData = loadCertificates();

        // Gera XML com dados fixos (os mesmos que já funcionaram)
        const xml = gerarXmlNfe({
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
        });

        const xmlAssinado = assinarXml(xml, certData);
        const xmlLimpo = xmlAssinado
            .replace(/<\?xml.*?\?>/g, '')
            .replace(/\r?\n/g, '')
            .replace(/\t/g, '')
            .replace(/>\s+</g, '><')
            .trim();

        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${xmlLimpo}</nfeDadosMsg></soap:Body></soap:Envelope>`;

        const httpsAgent = new https.Agent({
            cert: certData.cert,
            key: certData.privateKey,
            ca: certData.ca || undefined,
            rejectUnauthorized: false,
            secureProtocol: 'TLSv1_2_method',
            ciphers: 'DEFAULT@SECLEVEL=1'
        });

        const response = await axios.post(
            'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4',
            soapEnvelope,
            {
                httpsAgent,
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeDadosMsg'
                },
                timeout: 60000
            }
        );

        const cStatMatch = response.data.match(/<cStat>(\d+)<\/cStat>/);
        const xMotivoMatch = response.data.match(/<xMotivo>([^<]+)<\/xMotivo>/);
        const protocoloMatch = response.data.match(/<nProt>(\d+)<\/nProt>/);

        res.json({
            cStat: cStatMatch ? cStatMatch[1] : null,
            xMotivo: xMotivoMatch ? xMotivoMatch[1] : null,
            protocolo: protocoloMatch ? protocoloMatch[1] : null,
            resposta_completa: response.data.substring(0, 2000)
        });
    } catch (error) {
        console.error('Erro em /testar-soap-backend:', error);
        res.status(500).json({ error: error.message });
    }
});

// Rota para baixar o último XML gerado
router.get('/ultimo-xml', (req, res) => {
    const xmlPath = '/tmp/nfe_enviada.xml';
    if (fs.existsSync(xmlPath)) {
        const xml = fs.readFileSync(xmlPath, 'utf8');
        res.setHeader('Content-Type', 'application/xml');
        res.send(xml);
    } else {
        res.status(404).send('Nenhum XML gerado ainda.');
    }
});

module.exports = router;