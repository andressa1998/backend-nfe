// nfeController.js - Emissão, Cancelamento, Listagem, Consulta, Avulsa, Sincronização ML
const { gerarXmlNfe } = require('./xmlBuilder');
const { assinarXml } = require('./xmlSigner');
const NFEService = require('./nfeService');
const { loadCertificates } = require('./utils');
const supabase = require('./supabaseClient');
const { extrairProtocolo, extrairChaveAcesso } = require('./nfeUtils');

// ===================== Obter código IBGE (já existente) =====================
async function obterCodigoMunicipio(nomeCidade, uf, cep = null) {
    console.log(`🔍 Buscando IBGE para: ${nomeCidade}/${uf}`);
    const { data: municipioData, error: dbError } = await supabase
        .from('municipios')
        .select('codigo_ibge')
        .ilike('nome', nomeCidade.trim())
        .eq('uf', uf)
        .maybeSingle();

    if (municipioData && !dbError) {
        console.log(`✅ IBGE encontrado no banco: ${municipioData.codigo_ibge}`);
        return String(municipioData.codigo_ibge);
    }

    if (cep) {
        try {
            const cepLimpo = cep.replace(/\D/g, '');
            console.log(`📡 Consultando BrasilAPI para CEP: ${cepLimpo}`);
            const fetch = require('node-fetch');
            const response = await fetch(`https://brasilapi.com.br/api/cep/v1/${cepLimpo}`);
            if (response.ok) {
                const data = await response.json();
                if (data && data.ibge_code) {
                    const ibge = String(data.ibge_code);
                    console.log(`✅ IBGE encontrado via CEP: ${ibge}`);
                    await supabase.from('municipios').upsert({
                        codigo_ibge: parseInt(ibge),
                        nome: data.city,
                        uf: data.state
                    }, { onConflict: 'codigo_ibge' });
                    return ibge;
                }
            }
        } catch (err) { console.warn('⚠️ Erro na consulta de CEP:', err.message); }
    }
    throw new Error(`IBGE não encontrado para ${nomeCidade}/${uf}`);
}

// ===================== Importar NF-e no ML (já existente) =====================
async function importarNFEnoML(shipment_id, xml, token) {
    if (!shipment_id) return { ok: true };
    const url = `https://api.mercadolibre.com/shipments/${shipment_id}/invoice_data?siteId=MLB`;
    const fetch = require('node-fetch');
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/xml' },
            body: xml
        });
        if (!response.ok) {
            const text = await response.text();
            console.warn(`❌ ML retornou erro ${response.status}: ${text.substring(0, 200)}`);
            return { ok: false };
        }
        return { ok: true, xml_url: response.headers.get('location') };
    } catch (error) {
        console.warn('Erro ao importar NF-e no ML (não crítico):', error.message);
        return { ok: false };
    }
}

// ===================== Emissão de NF-e (MODIFICADA: salva cliente e NF-e no Supabase) =====================
async function emitirNFe(req, res) {
    console.log('📨 Requisição recebida:', req.method, req.url);
    try {
        const dados = req.body;
        const { venda_id, cliente, produtos, cfop, natureza_operacao, modalidade_frete, access_token, shipment_id, pack_id, transportadora_id } = dados;

        if (!cliente) throw new Error('Dados do cliente não fornecidos');
        const SELLER_UF = 'PR';
        const buyerUF = cliente.uf?.toUpperCase() || '';
        if (!buyerUF) throw new Error('UF do cliente não informada');
        if (buyerUF === SELLER_UF && cfop !== '5102')
            throw new Error(`Venda dentro do estado (${buyerUF}) exige CFOP 5102.`);
        if (buyerUF !== SELLER_UF && cfop !== '6108')
            throw new Error(`Venda fora do estado (${buyerUF}) exige CFOP 6108.`);

        let documento = cliente.documento || '';
        let tipoDoc = documento.includes('CNPJ') ? 'CNPJ' : 'CPF';
        let numeroDoc = documento.replace(/\D/g, '');

        const logradouro = cliente.endereco || cliente.logradouro || '';
        const numero = cliente.numero || 'S/N';
        const bairro = cliente.bairro || '';
        const cidade = cliente.cidade || '';
        const uf = cliente.uf || '';
        const cep = (cliente.cep || '').replace(/\D/g, '');

        const destinatario = {
            CPF: tipoDoc === 'CPF' ? numeroDoc : undefined,
            CNPJ: tipoDoc === 'CNPJ' ? numeroDoc : undefined,
            xNome: cliente.nome || '',
            xLgr: logradouro,
            nro: numero,
            xBairro: bairro,
            xMun: cidade,
            UF: uf,
            CEP: cep
        };
        if (!destinatario.xNome) throw new Error('Nome do cliente não informado');
        destinatario.cMun = await obterCodigoMunicipio(cidade, uf, cep);

        // Controle sequencial
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

        // Geração do XML
        const xml = gerarXmlNfe({
            nNF, serie, destinatario, produtos, cfop,
            natOp: natureza_operacao || 'VENDA',
            modFrete: modalidade_frete || '9',
            valor_total: produtos.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0)
        });

        const certData = loadCertificates();
        const xmlAssinado = assinarXml(xml, { privateKey: certData.privateKey, cert: certData.cert });

        const nfeService = new NFEService('homologacao'); // ou 'producao' dependendo do ambiente
        const respostaSefaz = await nfeService.sendNFe(xmlAssinado, certData);
        const protocolo = await extrairProtocolo(respostaSefaz);
        const chaveAcesso = extrairChaveAcesso(xmlAssinado);

        if (!protocolo) throw new Error('SEFAZ não retornou protocolo');
        console.log('✅ NF-e autorizada. Protocolo:', protocolo);

        // ========== SALVAR CLIENTE (se não existir) ==========
        let clienteId = null;
        const { data: clienteExistente } = await supabase
            .from('clientes')
            .select('id')
            .eq('documento', numeroDoc)
            .maybeSingle();
        if (clienteExistente) {
            clienteId = clienteExistente.id;
        } else {
            const { data: novoCliente, error: errCliente } = await supabase
                .from('clientes')
                .insert({
                    nome: cliente.nome,
                    documento: numeroDoc,
                    cep: cep,
                    uf: uf,
                    cidade: cidade,
                    logradouro: logradouro,
                    numero: numero,
                    bairro: bairro
                })
                .select();
            if (errCliente) console.warn('Erro ao salvar cliente:', errCliente);
            else if (novoCliente) clienteId = novoCliente[0].id;
        }

        // ========== SALVAR NF-e EMITIDA ==========
        const valorTotal = produtos.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0);
        await supabase.from('nfe_emitidas').insert({
            venda_id: venda_id || null,
            chave: chaveAcesso,
            protocolo: protocolo,
            xml: xmlAssinado,
            status: 'autorizada',
            cancelada: false,
            data_emissao: new Date().toISOString(),
            cliente_id: clienteId,
            transportadora_id: transportadora_id || null,
            valor_total: valorTotal
        });

        // Integração ML (se houver shipment_id e token)
        let mlResponse = { ok: true };
        if (shipment_id && access_token) {
            mlResponse = await importarNFEnoML(shipment_id, xmlAssinado, access_token);
            if (!mlResponse.ok) console.warn('Importação no ML falhou');
        }

        // Atualizar venda (se for venda)
        if (venda_id) {
            await supabase
                .from('vendas_ml')
                .update({
                    nfe_emitida: true,
                    nfe_chave: chaveAcesso,
                    nfe_protocolo: protocolo,
                    data_emissao: new Date().toISOString(),
                    nfe_xml_url: mlResponse.xml_url || null,
                    nfe_ultimo_evento_seq: 0
                })
                .eq('order_id', venda_id);
        }

        res.json({ success: true, protocolo, chaveAcesso });
    } catch (error) {
        console.error('❌ Erro na emissão:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

// ===================== Cancelamento de NF-e =====================
async function cancelarNFe(req, res) {
    console.log('📨 Requisição de cancelamento recebida:', req.body);
    try {
        const { venda_id, chaveAcesso, justificativa } = req.body;
        if (!venda_id && !chaveAcesso) throw new Error('venda_id ou chaveAcesso é obrigatório');

        let venda = null;
        if (venda_id) {
            const { data, error } = await supabase
                .from('vendas_ml')
                .select('*')
                .eq('order_id', venda_id)
                .single();
            if (error || !data || !data.nfe_emitida) throw new Error('Venda não encontrada ou NF-e não emitida');
            if (data.nfe_cancelada) throw new Error('Esta NF-e já foi cancelada');
            venda = data;
        }

        const chaveNumerica = chaveAcesso ? chaveAcesso.replace(/\D/g, '') : venda.nfe_chave.replace(/\D/g, '');
        if (chaveNumerica.length !== 44) throw new Error('Chave de acesso inválida');

        // Buscar último seq da NF-e (usar tabela nfe_emitidas)
        const { data: nfeData } = await supabase
            .from('nfe_emitidas')
            .select('ultimo_evento_seq, protocolo')
            .eq('chave', chaveNumerica)
            .maybeSingle();
        let ultimoSeq = nfeData?.ultimo_evento_seq || 0;
        let nSeqEvento = ultimoSeq + 1;
        const protocoloNF = nfeData?.protocolo || venda?.nfe_protocolo;

        const xmlEvento = montarXmlCancelamentoCorrigido({
            chaveAcesso: chaveNumerica,
            protocolo: protocoloNF,
            justificativa: justificativa || 'Cancelamento solicitado pelo usuário',
            tpAmb: '1',
            nSeqEvento: nSeqEvento.toString()
        });

        const certData = loadCertificates();
        const xmlAssinado = assinarXmlEvento(xmlEvento, certData);
        const nfeService = new NFEService('producao');
        const respostaSefaz = await nfeService.sendEvento(xmlAssinado, certData);
        const resultado = extrairResultadoCancelamento(respostaSefaz);

        if (!resultado.cancelado) {
            if (resultado.cStat === '128') {
                const consulta = await nfeService.consultarStatus(chaveNumerica, certData);
                const cStatConsulta = consulta.match(/<cStat>(\d+)<\/cStat>/)?.[1];
                if (cStatConsulta === '101' || cStatConsulta === '135') {
                    console.log('✅ NF-e já está cancelada na SEFAZ');
                } else {
                    throw new Error(`SEFAZ rejeitou cancelamento: ${resultado.motivo} (cStat=${resultado.cStat})`);
                }
            } else {
                throw new Error(`SEFAZ rejeitou cancelamento: ${resultado.motivo} (cStat=${resultado.cStat})`);
            }
        }

        // Atualizar tabelas
        await supabase
            .from('nfe_emitidas')
            .update({
                cancelada: true,
                cancelamento_protocolo: resultado.protocolo,
                cancelamento_justificativa: justificativa,
                data_cancelamento: new Date().toISOString(),
                ultimo_evento_seq: nSeqEvento
            })
            .eq('chave', chaveNumerica);

        if (venda_id) {
            await supabase
                .from('vendas_ml')
                .update({
                    nfe_cancelada: true,
                    nfe_cancelamento_protocolo: resultado.protocolo,
                    nfe_cancelamento_justificativa: justificativa,
                    nfe_cancelamento_data: new Date().toISOString(),
                    nfe_ultimo_evento_seq: nSeqEvento
                })
                .eq('order_id', venda_id);
        }

        res.json({ success: true, protocoloCancelamento: resultado.protocolo });
    } catch (error) {
        console.error('❌ Erro no cancelamento:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

// ===================== Listar NF-es emitidas =====================
async function listarNFesEmitidas(req, res) {
    try {
        const { data, error } = await supabase
            .from('nfe_emitidas')
            .select('*, clientes(nome)')
            .order('data_emissao', { ascending: false });
        if (error) throw error;
        res.json({ success: true, notas: data });
    } catch (error) {
        console.error('Erro ao listar NF-es:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

// ===================== Listar transportadoras =====================
async function listarTransportadoras(req, res) {
    try {
        const { data, error } = await supabase
            .from('transportadoras')
            .select('*')
            .order('nome');
        if (error) throw error;
        res.json({ success: true, transportadoras: data });
    } catch (error) {
        console.error('Erro ao listar transportadoras:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

// ===================== Cadastrar transportadora =====================
async function cadastrarTransportadora(req, res) {
    try {
        const { nome, cnpj, ie, endereco, cidade, uf } = req.body;
        if (!nome || !cnpj) throw new Error('Nome e CNPJ são obrigatórios');
        const { data, error } = await supabase
            .from('transportadoras')
            .insert([{ nome, cnpj, ie, endereco, cidade, uf }])
            .select();
        if (error) throw error;
        res.json({ success: true, transportadora: data[0] });
    } catch (error) {
        console.error('Erro ao cadastrar transportadora:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

// ===================== Listar clientes =====================
async function listarClientes(req, res) {
    try {
        const { data, error } = await supabase
            .from('clientes')
            .select('*')
            .order('nome');
        if (error) throw error;
        res.json({ success: true, clientes: data });
    } catch (error) {
        console.error('Erro ao listar clientes:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

// ===================== Emitir NF-e avulsa (sem venda) =====================
async function emitirNFEAvulsa(req, res) {
    try {
        const { cliente, produtos, cfop, natureza_operacao, modalidade_frete, transportadora_id } = req.body;
        if (!cliente || !produtos || !produtos.length) throw new Error('Dados incompletos');

        // Se cliente veio apenas com id, buscar dados completos
        let clienteCompleto = cliente;
        if (cliente.id && !cliente.nome) {
            const { data, error } = await supabase
                .from('clientes')
                .select('*')
                .eq('id', cliente.id)
                .single();
            if (error || !data) throw new Error('Cliente não encontrado');
            clienteCompleto = data;
        }

        const dados = {
            venda_id: null,
            cliente: clienteCompleto,
            produtos,
            cfop,
            natureza_operacao: natureza_operacao || 'VENDA',
            modalidade_frete: modalidade_frete || '9',
            access_token: null,
            shipment_id: null,
            pack_id: null,
            transportadora_id
        };
        // Reutiliza a função de emissão (mas sem venda_id)
        const emitResult = await new Promise((resolve, reject) => {
            emitirNFe({
                body: dados,
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

// ===================== Consultar situação da NF-e na SEFAZ =====================
async function consultarStatusNFE(req, res) {
    try {
        const { chaveAcesso } = req.body;
        if (!chaveAcesso) throw new Error('Chave de acesso é obrigatória');
        const chaveNumerica = chaveAcesso.replace(/\D/g, '');
        if (chaveNumerica.length !== 44) throw new Error('Chave deve ter 44 dígitos');
        const certData = loadCertificates();
        const nfeService = new NFEService('producao');
        const resposta = await nfeService.consultarStatus(chaveNumerica, certData);
        const cStatMatch = resposta.match(/<cStat>(\d+)<\/cStat>/);
        const xMotivoMatch = resposta.match(/<xMotivo>([^<]+)<\/xMotivo>/);
        const cStat = cStatMatch ? cStatMatch[1] : '999';
        const motivo = xMotivoMatch ? xMotivoMatch[1] : 'Desconhecido';
        res.json({ success: true, cStat, motivo, resposta: resposta.substring(0, 500) });
    } catch (error) {
        console.error('Erro na consulta:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

// ===================== NOVAS FUNÇÕES PARA INTEGRAÇÃO ML =====================

// Sincronizar vendas do ML a partir de 01/06/2026
async function sincronizarVendasML(req, res) {
    console.log('🔄 Sincronizando vendas do ML para NF-e...');
    try {
        // Importa a função do ml_token_manager (ajuste o caminho conforme sua estrutura)
        const { buscarVendasML } = require('./ml_token_manager');
        const result = await buscarVendasML(100);
        if (!result.success) throw new Error(result.error || 'Erro ao buscar vendas');

        const vendas = result.vendas;
        const dataReferencia = new Date('2026-06-01');
        const vendasFiltradas = vendas.filter(v => new Date(v.data_venda) >= dataReferencia);

        let novas = 0;
        for (const venda of vendasFiltradas) {
            // Verifica se já existe no Supabase
            const { data: existing } = await supabase
                .from('vendas_ml')
                .select('order_id')
                .eq('order_id', venda.id_venda_ml)
                .maybeSingle();

            if (!existing) {
                // Insere a venda com nfe_emitida = false
                await supabase.from('vendas_ml').insert({
                    order_id: venda.id_venda_ml,
                    cliente_nome: venda.cliente,
                    cpf_cnpj: null,
                    endereco: null,
                    sku: venda.sku,
                    mlb_id: venda.mlb_id,
                    valor_total: venda.valor_total,
                    data_venda: venda.data_venda,
                    produtos: venda.dados_completos,
                    meio_envio: venda.tipo_envio,
                    nfe_emitida: false
                });
                novas++;
            }
        }

        res.json({ success: true, novas, total: vendasFiltradas.length });
    } catch (error) {
        console.error('❌ Erro ao sincronizar vendas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

// Listar vendas sem NF-e
async function listarVendasSemNFE(req, res) {
    try {
        const { data, error } = await supabase
            .from('vendas_ml')
            .select('*')
            .eq('nfe_emitida', false)
            .order('data_venda', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Listar vendas com NF-e (opcional)
async function listarVendasComNFE(req, res) {
    try {
        const { data, error } = await supabase
            .from('vendas_ml')
            .select('*, nfe_emitidas(*)')
            .eq('nfe_emitida', true)
            .order('data_venda', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

// Buscar XML da NF-e por chave
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

// ===================== Funções auxiliares (cancelamento) =====================
function montarXmlCancelamentoCorrigido({ chaveAcesso, protocolo, justificativa, tpAmb = '1', nSeqEvento }) {
    const now = new Date();
    const dhEvento = now.toISOString().replace(/\.\d{3}Z$/, '-03:00');
    const tpEvento = '110111';
    const idLote = Math.floor(Math.random() * 999999999999999);
    const id = `ID${chaveAcesso}${tpEvento}${nSeqEvento}`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
    <idLote>${idLote}</idLote>
    <evento versao="1.00">
        <infEvento Id="${id}">
            <cOrgao>41</cOrgao>
            <tpAmb>${tpAmb}</tpAmb>
            <CNPJ>32830261000125</CNPJ>
            <chNFe>${chaveAcesso}</chNFe>
            <dhEvento>${dhEvento}</dhEvento>
            <tpEvento>${tpEvento}</tpEvento>
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
    let cStatMatch = respostaXml.match(/<cStat[^>]*>(\d+)<\/cStat>/);
    let xMotivoMatch = respostaXml.match(/<xMotivo[^>]*>([^<]+)<\/xMotivo>/);
    let nProtMatch = respostaXml.match(/<nProt[^>]*>(\d+)<\/nProt>/);
    const cStat = cStatMatch ? cStatMatch[1] : '999';
    const motivo = xMotivoMatch ? xMotivoMatch[1] : 'Erro desconhecido';
    const protocolo = nProtMatch ? nProtMatch[1] : null;
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