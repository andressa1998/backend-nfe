const express = require('express');
const fs = require('fs');
const https = require('https');
const axios = require('axios');

// Controlador para a emissão (usando node-nfe)
const { emitirNFe } = require('./nfeControllerNodeNfe');

// Demais funções do controlador original (exceto emitirNFe)
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

// Função auxiliar para carregar certificado (mesmo do nfeController)
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

// ===================== ROTA DE TESTE: ENVELOPE SOAP COMPLETO =====================
router.get('/testar-soap-envelope', async (req, res) => {
    try {
        // Dados fixos para teste (usando os mesmos do XML que já funcionou)
        const certData = loadCertificates();

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

        // Limpa o XML (remove declaração, quebras de linha, espaços entre tags)
        const xmlLimpo = xmlAssinado
            .replace(/<\?xml.*?\?>/g, '')
            .replace(/\r?\n/g, '')
            .replace(/\t/g, '')
            .replace(/>\s+</g, '><')
            .trim();

        // Monta o envelope SOAP exatamente como será enviado
        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${xmlLimpo}</nfeDadosMsg></soap:Body></soap:Envelope>`;

        // Salva em arquivo para download
        const filePath = '/tmp/soap_envelope.xml';
        fs.writeFileSync(filePath, soapEnvelope, 'utf8');

        // Envia o arquivo para download
        res.setHeader('Content-Type', 'application/xml');
        res.setHeader('Content-Disposition', 'attachment; filename="soap_envelope.xml"');
        res.send(soapEnvelope);
    } catch (error) {
        console.error('Erro ao gerar envelope SOAP:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===================== ROTA PARA BAIXAR O ÚLTIMO XML =====================
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