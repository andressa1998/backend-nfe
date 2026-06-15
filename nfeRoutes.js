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

// 🔥 ROTA DE TESTE: envia o último XML gerado (puro, sem envelope SOAP) diretamente para a SEFAZ
router.post('/testar-xml-raw', async (req, res) => {
    try {
        const xmlPath = '/tmp/nfe_enviada.xml';
        if (!fs.existsSync(xmlPath)) {
            return res.status(404).json({ error: 'Nenhum XML gerado ainda. Emita uma NF-e primeiro.' });
        }
        const xml = fs.readFileSync(xmlPath, 'utf8');

        // Carrega o certificado PFX diretamente das variáveis de ambiente
        const pfxBase64 = process.env.PFX_BASE64;
        const pfxPassword = process.env.PFX_PASSWORD;
        if (!pfxBase64 || !pfxPassword) {
            return res.status(500).json({ error: 'Certificado não configurado (PFX_BASE64 e PFX_PASSWORD)' });
        }
        const pfxBuffer = Buffer.from(pfxBase64, 'base64');

        const httpsAgent = new https.Agent({
            pfx: pfxBuffer,
            passphrase: pfxPassword,
            rejectUnauthorized: false
        });

        // Envia o XML puro (exatamente como o Insomnia faria)
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

        // Extrai informações da resposta
        const cStatMatch = response.data.match(/<cStat>(\d+)<\/cStat>/);
        const xMotivoMatch = response.data.match(/<xMotivo>([^<]+)<\/xMotivo>/);
        const protocoloMatch = response.data.match(/<nProt>(\d+)<\/nProt>/);

        res.json({
            cStat: cStatMatch ? cStatMatch[1] : null,
            xMotivo: xMotivoMatch ? xMotivoMatch[1] : null,
            protocolo: protocoloMatch ? protocoloMatch[1] : null,
            resposta_completa: response.data.substring(0, 2000) // limite para não estourar
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