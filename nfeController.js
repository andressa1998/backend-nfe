const { gerarXmlNfe } = require('./xmlBuilder');
const { assinarXml } = require('./xmlSigner');
const NFEService = require('./nfeService');
const { loadCertificates } = require('./utils');
const supabase = require('./supabaseClient');
const { extrairProtocolo, extrairChaveAcesso } = require('./nfeUtils');

const DEFAULT_IBGE = '4101804'; // Araucária/PR

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
        return DEFAULT_IBGE;
    } catch (error) {
        console.warn('Erro ao obter IBGE, usando padrão:', error.message);
        return DEFAULT_IBGE;
    }
}

async function emitirNFe(req, res) {
    console.log('📨 Requisição de emissão recebida');
    try {
        const dados = req.body;
        const { venda_id, cliente, produtos, cfop, natureza_operacao, modalidade_frete, transportadora_id } = dados;

        if (!cliente) throw new Error('Cliente não informado');

        const SELLER_UF = 'PR';
        let buyerUF = (cliente.uf || 'PR').toUpperCase();
        if (buyerUF === SELLER_UF && cfop !== '5102')
            throw new Error(`Venda dentro do estado (${buyerUF}) exige CFOP 5102.`);
        if (buyerUF !== SELLER_UF && cfop !== '6108')
            throw new Error(`Venda fora do estado (${buyerUF}) exige CFOP 6108.`);

        let documento = cliente.documento || '';
        let tipoDoc = documento.includes('CNPJ') ? 'CNPJ' : 'CPF';
        let numeroDoc = documento.replace(/\D/g, '');

        const logradouro = cliente.endereco || cliente.logradouro || 'NÃO INFORMADO';
        const numero = cliente.numero || 'S/N';
        const bairro = cliente.bairro || 'CENTRO';
        let cidade = cliente.cidade || 'ARAUCARIA';
        let uf = buyerUF;
        let cep = (cliente.cep || '83702090').replace(/\D/g, '');

        const destinatario = {
            CPF: tipoDoc === 'CPF' ? numeroDoc : undefined,
            CNPJ: tipoDoc === 'CNPJ' ? numeroDoc : undefined,
            xNome: cliente.nome || 'Cliente não identificado',
            xLgr: logradouro,
            nro: numero,
            xBairro: bairro,
            xMun: cidade,
            UF: uf,
            CEP: cep,
            cMun: await obterCodigoMunicipio(cidade, uf, cep)
        };

        // Controle sequencial da NF
        const serie = 1;
        let nNF = null;
        for (let i = 0; i < 5; i++) {
            try {
                const { data: controle } = await supabase
                    .from('controle_nfe')
                    .select('ultimo_numero')
                    .eq('serie', serie)
                    .maybeSingle();
                const proximo = (controle?.ultimo_numero || 50000) + 1;
                const { error } = await supabase
                    .from('controle_nfe')
                    .upsert({ serie, ultimo_numero: proximo }, { onConflict: 'serie' });
                if (!error) {
                    nNF = proximo;
                    console.log(`✅ Número NF alocado: ${nNF}`);
                    break;
                }
            } catch (err) { console.warn(err); }
            await new Promise(r => setTimeout(r, 200));
        }
        if (!nNF) nNF = Math.floor(Math.random() * 900000000) + 100000000;

        // Gerar XML
        const xml = gerarXmlNfe({
            nNF, serie, destinatario, produtos, cfop,
            natOp: natureza_operacao || 'VENDA',
            modFrete: modalidade_frete || '9',
            valor_total: produtos.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0)
        });

        const certData = loadCertificates();
        const xmlAssinado = assinarXml(xml, { privateKey: certData.privateKey, cert: certData.cert });

        const nfeService = new NFEService('homologacao');
        const respostaSefaz = await nfeService.sendNFe(xmlAssinado, certData);
        const protocolo = extrairProtocolo(respostaSefaz);
        const chaveAcesso = extrairChaveAcesso(xmlAssinado);

        if (!protocolo) throw new Error('SEFAZ não retornou protocolo');
        console.log('✅ NF-e autorizada. Protocolo:', protocolo);

        // Salvar NF-e no banco
        const valorTotal = produtos.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0);
        await supabase.from('nfe_emitidas').insert({
            venda_id: venda_id || null,
            chave: chaveAcesso,
            protocolo: protocolo,
            xml: xmlAssinado,
            status: 'autorizada',
            cancelada: false,
            data_emissao: new Date().toISOString(),
            transportadora_id: transportadora_id || null,
            valor_total: valorTotal
        });

        // Atualizar venda (se for uma venda existente)
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

async function cancelarNFe(req, res) {
    console.log('📨 Requisição de cancelamento recebida');
    try {
        const { venda_id, chaveAcesso, justificativa } = req.body;
        let chave = chaveAcesso;
        if (!chave && venda_id) {
            const { data } = await supabase.from('vendas_ml').select('nfe_chave').eq('id', venda_id).single();
            if (!data?.nfe_chave) throw new Error('NF-e não encontrada para esta venda');
            chave = data.nfe_chave;
        }
        if (!chave) throw new Error('Chave de acesso não informada');
        const chaveNumerica = chave.replace(/\D/g, '');
        if (chaveNumerica.length !== 44) throw new Error('Chave inválida');

        // Buscar último seq de evento
        const { data: nfeData } = await supabase.from('nfe_emitidas').select('ultimo_evento_seq, protocolo').eq('chave', chaveNumerica).maybeSingle();
        let nSeqEvento = (nfeData?.ultimo_evento_seq || 0) + 1;

        const xmlEvento = montarXmlCancelamento(chaveNumerica, nfeData?.protocolo || '', justificativa || 'Cancelamento solicitado', nSeqEvento);
        const certData = loadCertificates();
        const xmlAssinado = assinarXmlEvento(xmlEvento, certData);
        const nfeService = new NFEService('homologacao');
        const resposta = await nfeService.sendEvento(xmlAssinado, certData);
        const resultado = extrairResultadoCancelamento(resposta);

        if (!resultado.cancelado && resultado.cStat !== '135' && resultado.cStat !== '136') {
            throw new Error(`SEFAZ rejeitou cancelamento: ${resultado.motivo} (cStat=${resultado.cStat})`);
        }

        await supabase.from('nfe_emitidas').update({
            cancelada: true,
            cancelamento_protocolo: resultado.protocolo,
            cancelamento_justificativa: justificativa,
            data_cancelamento: new Date().toISOString(),
            ultimo_evento_seq: nSeqEvento
        }).eq('chave', chaveNumerica);

        if (venda_id) {
            await supabase.from('vendas_ml').update({
                nfe_cancelada: true,
                nfe_cancelamento_protocolo: resultado.protocolo,
                nfe_cancelamento_justificativa: justificativa,
                nfe_cancelamento_data: new Date().toISOString(),
                nfe_ultimo_evento_seq: nSeqEvento
            }).eq('id', venda_id);
        }

        res.json({ success: true, protocoloCancelamento: resultado.protocolo });
    } catch (error) {
        console.error('❌ Erro no cancelamento:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

async function listarNFesEmitidas(req, res) {
    try {
        const { data, error } = await supabase
            .from('nfe_emitidas')
            .select('*')
            .order('data_emissao', { ascending: false });
        if (error) throw error;
        res.json({ success: true, notas: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function listarTransportadoras(req, res) {
    try {
        const { data, error } = await supabase.from('transportadoras').select('*').order('nome');
        if (error) throw error;
        res.json({ success: true, transportadoras: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function cadastrarTransportadora(req, res) {
    try {
        const { nome, cnpj, ie, endereco, cidade, uf } = req.body;
        if (!nome || !cnpj) throw new Error('Nome e CNPJ obrigatórios');
        const { data, error } = await supabase.from('transportadoras').insert([{ nome, cnpj, ie, endereco, cidade, uf }]).select();
        if (error) throw error;
        res.json({ success: true, transportadora: data[0] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function listarClientes(req, res) {
    try {
        const { data, error } = await supabase.from('clientes').select('*').order('nome');
        if (error) throw error;
        res.json({ success: true, clientes: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

async function emitirNFEAvulsa(req, res) {
    try {
        const { cliente, produtos, cfop, natureza_operacao, modalidade_frete, transportadora_id } = req.body;
        if (!cliente || !produtos || !produtos.length) throw new Error('Dados incompletos');
        // Reutiliza a função emitirNFe com venda_id = null
        const emitResult = await new Promise((resolve, reject) => {
            emitirNFe({
                body: { venda_id: null, cliente, produtos, cfop, natureza_operacao, modalidade_frete, transportadora_id },
                json: resolve,
                status: (code) => ({ json: (obj) => reject({ status: code, ...obj }) })
            }, {
                json: resolve,
                status: (code) => ({ json: (obj) => reject({ status: code, ...obj }) })
            }).catch(reject);
        });
        res.json(emitResult);
    } catch (error) {
        console.error('Erro na emissão avulsa:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

async function consultarStatusNFE(req, res) {
    try {
        const { chaveAcesso } = req.body;
        if (!chaveAcesso) throw new Error('Chave obrigatória');
        const certData = loadCertificates();
        const nfeService = new NFEService('homologacao');
        const resposta = await nfeService.consultarStatus(chaveAcesso.replace(/\D/g, ''), certData);
        const cStat = resposta.match(/<cStat>(\d+)<\/cStat>/)?.[1] || '999';
        const xMotivo = resposta.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] || 'Desconhecido';
        res.json({ success: true, cStat, xMotivo });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// ========== FUNÇÃO CORRIGIDA PARA LISTAR VENDAS SEM NF-E ==========
async function listarVendasSemNFE(req, res) {
    try {
        const { data, error } = await supabase
            .from('vendas_ml')
            .select('id, cliente, sku, valor_total, data_venda, dados_completos, meio_envio')
            .eq('nfe_emitida', false);

        if (error) throw error;
        if (!data || data.length === 0) {
            return res.json([]);
        }

        const vendas = data.map(v => ({
            id: v.id,
            order_id: String(v.id),
            cliente_nome: v.cliente || 'Cliente',
            sku: v.sku,
            valor_total: v.valor_total,
            data_venda: v.data_venda,
            produtos: v.dados_completos, // <-- usa a coluna correta
            meio_envio: v.meio_envio
        }));
        res.json(vendas);
    } catch (error) {
        console.error('Erro em listarVendasSemNFE:', error);
        res.status(500).json({ error: error.message });
    }
}

async function listarVendasComNFE(req, res) {
    try {
        const { data, error } = await supabase
            .from('vendas_ml')
            .select('*, nfe_emitidas(*)')
            .eq('nfe_emitida', true);
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

async function buscarXMLPorChave(req, res) {
    const { chave } = req.query;
    if (!chave) return res.status(400).json({ error: 'Chave não informada' });
    try {
        const { data, error } = await supabase
            .from('nfe_emitidas')
            .select('xml')
            .eq('chave', chave)
            .single();
        if (error || !data) return res.status(404).json({ error: 'NF-e não encontrada' });
        res.json({ xml: data.xml });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Sincronização desabilitada no backend
async function sincronizarVendasML(req, res) {
    res.status(200).json({ success: false, message: 'Use o frontend (módulo de Vendas ML) para sincronizar as vendas.' });
}

// Funções auxiliares para cancelamento
function montarXmlCancelamento(chaveAcesso, protocolo, justificativa, nSeqEvento) {
    const now = new Date();
    const dhEvento = now.toISOString().replace(/\.\d{3}Z$/, '-03:00');
    const id = `ID${chaveAcesso}110111${nSeqEvento}`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
    <idLote>${Math.floor(Math.random() * 999999999999999)}</idLote>
    <evento versao="1.00">
        <infEvento Id="${id}">
            <cOrgao>41</cOrgao>
            <tpAmb>2</tpAmb>
            <CNPJ>32830261000125</CNPJ>
            <chNFe>${chaveAcesso}</chNFe>
            <dhEvento>${dhEvento}</dhEvento>
            <tpEvento>110111</tpEvento>
            <nSeqEvento>${nSeqEvento}</nSeqEvento>
            <verEvento>1.00</verEvento>
            <detEvento versao="1.00">
                <descEvento>Cancelamento</descEvento>
                <nProt>${protocolo}</nProt>
                <xJust>${justificativa.substring(0, 255)}</xJust>
            </detEvento>
        </infEvento>
    </evento>
</envEvento>`;
}

function assinarXmlEvento(xml, certData) {
    const { SignedXml } = require('xml-crypto');
    const sig = new SignedXml();
    sig.privateKey = certData.privateKey;
    sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
    sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
    sig.addReference({
        xpath: "//*[local-name(.)='infEvento']",
        transforms: [
            'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
            'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
        ],
        digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
        uri: ''
    });
    sig.getKeyInfoContent = function () {
        const cert = certData.cert
            .replace('-----BEGIN CERTIFICATE-----', '')
            .replace('-----END CERTIFICATE-----', '')
            .replace(/\r/g, '').replace(/\n/g, '');
        return `<X509Data><X509Certificate>${cert}</X509Certificate></X509Data>`;
    };
    sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='infEvento']", action: 'after' } });
    let signedXml = sig.getSignedXml();
    signedXml = signedXml.replace('<Signature>', '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
    signedXml = signedXml.replace(/xmlns=""/g, '');
    return signedXml;
}

function extrairResultadoCancelamento(respostaXml) {
    const cStat = respostaXml.match(/<cStat[^>]*>(\d+)<\/cStat>/)?.[1] || '999';
    const motivo = respostaXml.match(/<xMotivo[^>]*>([^<]+)<\/xMotivo>/)?.[1] || 'Erro desconhecido';
    const protocolo = respostaXml.match(/<nProt[^>]*>(\d+)<\/nProt>/)?.[1] || null;
    const cancelado = (cStat === '135' || cStat === '136');
    return { cancelado, cStat, motivo, protocolo };
}

module.exports = {
    emitirNFe,
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
    buscarXMLPorChave
};