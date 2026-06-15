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

// 🔥 ROTA DE TESTE: envia o último XML gerado (puro) diretamente para a SEFAZ
router.post('/testar-xml-raw', async (req, res) => {
    try {
        const xmlPath = '/tmp/nfe_enviada.xml';
        if (!fs.existsSync(xmlPath)) {
            return res.status(404).json({ error: 'Nenhum XML gerado ainda. Emita uma NF-e primeiro.' });
        }
        const xml = fs.readFileSync(xmlPath, 'utf8');

        // Carrega o certificado usando a mesma função que já funciona (do nfeController)
        const certData = loadCertificates();

        const httpsAgent = new https.Agent({
            cert: certData.cert,
            key: certData.privateKey,
            ca: certData.ca || undefined,
            rejectUnauthorized: false,
            secureProtocol: 'TLSv1_2_method',
            ciphers: 'DEFAULT@SECLEVEL=1'
        });

        // Envia o XML puro (sem envelope SOAP)
        const response = await axios.post(
            'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4',
            xml,
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
        console.error('Erro na rota /testar-xml-raw:', error);
        res.status(500).json({ error: error.message });
    }
});

// 🔥 ROTA PARA BAIXAR O ÚLTIMO XML GERADO (via navegador)
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