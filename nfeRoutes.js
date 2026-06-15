const express = require('express');
const router = express.Router();

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

// Rotas principais
router.post('/emitir', emitirNFe);                     // EMISSÃO com node-nfe
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

// Rota de teste (XML fixo)
router.post('/testar-xml-fixo', testarEnvioXMLFixo);

module.exports = router;