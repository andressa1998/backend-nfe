// nfeController.js - Emissão, Cancelamento, Listagem, Consulta, Avulsa, Sincronização ML
const { gerarXmlNfe } = require('./xmlBuilder');
const { assinarXml } = require('./xmlSigner');
const NFEService = require('./nfeService');
const { loadCertificates } = require('./utils');
const supabase = require('./supabaseClient');
const { extrairProtocolo, extrairChaveAcesso } = require('./nfeUtils');
const fs = require('fs');

const DEFAULT_IBGE = '4101804'; // Araucária/PR (fallback)

// ===================== OBTER CÓDIGO IBGE =====================
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

        console.warn(`⚠️ IBGE não encontrado para ${nomeCidade}/${uf}, usando padrão ${DEFAULT_IBGE}`);
        return DEFAULT_IBGE;
    } catch (error) {
        console.error('❌ Erro ao obter IBGE:', error);
        return DEFAULT_IBGE;
    }
}

// ===================== IMPORTAR NF-e NO ML =====================
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

// ===================== EMISSÃO DE NF-e =====================
async function emitirNFe(req, res) {
    console.log('📨 Requisição de emissão recebida');
    try {
        const dados = req.body;
        const { venda_id, cliente, produtos, cfop, natureza_operacao, modalidade_frete, transportadora_id } = dados;

        if (!cliente) throw new Error('Cliente não informado');
        if (!produtos || produtos.length === 0) throw new Error('Nenhum produto informado');

        const SELLER_UF = 'PR';
        let buyerUF = (cliente.uf || 'PR').toUpperCase();
        if (buyerUF === SELLER_UF && cfop !== '5102')
            throw new Error(`Venda dentro do estado (${buyerUF}) exige CFOP 5102.`);
        if (buyerUF !== SELLER_UF && cfop !== '6108')
            throw new Error(`Venda fora do estado (${buyerUF}) exige CFOP 6108.`);

        // ========== TRATAMENTO DO CPF/CNPJ ==========
        let documento = (cliente.documento || '').replace(/\D/g, '');
        if (!documento || (documento.length !== 11 && documento.length !== 14)) {
            console.warn('⚠️ Documento inválido, usando CPF genérico para homologação');
            documento = '99999999999';
        }
        let tipoDoc = (documento.length === 14) ? 'CNPJ' : 'CPF';

        // ========== DADOS DO DESTINATÁRIO ==========
        const logradouro = cliente.endereco || cliente.logradouro || 'NÃO INFORMADO';
        const numero = cliente.numero || 'S/N';
        const bairro = cliente.bairro || 'CENTRO';
        let cidade = cliente.cidade || 'ARAUCARIA';
        let uf = buyerUF;
        let cep = (cliente.cep || '83702090').replace(/\D/g, '');
        if (cep.length !== 8) cep = '83702090';

        let codigoIbge = DEFAULT_IBGE;
        try {
            codigoIbge = await obterCodigoMunicipio(cidade, uf, cep);
        } catch (err) {
            console.warn('Erro ao obter IBGE, usando padrão:', err.message);
        }

        const destinatario = {
            xNome: cliente.nome || 'Consumidor Final',
            xLgr: logradouro,
            nro: numero,
            xBairro: bairro,
            xMun: cidade,
            UF: uf,
            CEP: cep,
            cMun: codigoIbge
        };
        if (tipoDoc === 'CPF') {
            destinatario.CPF = documento;
        } else {
            destinatario.CNPJ = documento;
        }

        // ========== CONTROLE SEQUENCIAL DA NF ==========
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

        // ========== GERAR XML ==========
        const xml = gerarXmlNfe({
            nNF, serie, destinatario, produtos, cfop,
            natOp: natureza_operacao || 'VENDA',
            modFrete: modalidade_frete || '9',
            valor_total: produtos.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0)
        });

        // ========== ASSINAR XML ==========
        const certData = loadCertificates();
        console.log('🔑 Certificado carregado?', !!certData.privateKey, !!certData.cert, !!certData.ca);
        const xmlAssinado = assinarXml(xml, { privateKey: certData.privateKey, cert: certData.cert });

        // 🔹 SALVAR XML PARA DEPURAÇÃO
        const xmlPath = '/tmp/nfe_enviada.xml';
        fs.writeFileSync(xmlPath, xmlAssinado);
        console.log(`📄 XML COMPLETO salvo em ${xmlPath}`);
        
        // 🔹 LOG DO CONTEÚDO DO XML (primeiros 2000 caracteres)
        const xmlContent = fs.readFileSync(xmlPath, 'utf8');
        console.log('========== XML ENVIADO (primeiros 2000 caracteres) ==========');
        console.log(xmlContent.substring(0, 2000));
        console.log('============================================================');

        // ========== ENVIAR PARA SEFAZ ==========
        const nfeService = new NFEService('homologacao'); // altere para 'producao' quando for produção
        const respostaSefaz = await nfeService.sendNFe(xmlAssinado, certData);

        // 🔹 SALVAR RESPOSTA DA SEFAZ
        const respPath = '/tmp/resposta_sefaz.xml';
        fs.writeFileSync(respPath, respostaSefaz);
        console.log(`📨 RESPOSTA COMPLETA SEFAZ salva em ${respPath}`);
        
        // 🔹 LOG DO CONTEÚDO DA RESPOSTA (primeiros 2000 caracteres)
        const respContent = fs.readFileSync(respPath, 'utf8');
        console.log('========== RESPOSTA SEFAZ (primeiros 2000 caracteres) ==========');
        console.log(respContent.substring(0, 2000));
        console.log('===============================================================');

        const protocolo = extrairProtocolo(respostaSefaz);
        const chaveAcesso = extrairChaveAcesso(xmlAssinado);

        if (!protocolo) throw new Error('SEFAZ não retornou protocolo');
        console.log('✅ NF-e autorizada. Protocolo:', protocolo);

        // ========== SALVAR NF-e NO SUPABASE ==========
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

// ===================== CANCELAMENTO DE NF-e =====================
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

// ===================== LISTAR NF-ES EMITIDAS =====================
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

// ===================== TRANSPORTADORAS =====================
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

// ===================== CLIENTES =====================
async function listarClientes(req, res) {
    try {
        const { data, error } = await supabase.from('clientes').select('*').order('nome');
        if (error) throw error;
        res.json({ success: true, clientes: data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
}

// ===================== EMISSÃO AVULSA =====================
async function emitirNFEAvulsa(req, res) {
    try {
        const { cliente, produtos, cfop, natureza_operacao, modalidade_frete, transportadora_id } = req.body;
        if (!cliente || !produtos || !produtos.length) throw new Error('Dados incompletos');
        const dados = {
            venda_id: null,
            cliente,
            produtos,
            cfop,
            natureza_operacao: natureza_operacao || 'VENDA',
            modalidade_frete: modalidade_frete || '9',
            transportadora_id
        };
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

// ===================== CONSULTAR STATUS =====================
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

// ===================== VENDAS SEM NF-e (listagem) =====================
async function listarVendasSemNFE(req, res) {
    try {
        const { data, error } = await supabase
            .from('vendas_ml')
            .select('id, cliente, sku, valor_total, data_venda, dados_completos, meio_envio')
            .eq('nfe_emitida', false);
        if (error) throw error;
        if (!data) return res.json([]);
        const vendas = data.map(v => ({
            id: v.id,
            order_id: String(v.id),
            cliente_nome: v.cliente || 'Cliente',
            sku: v.sku,
            valor_total: v.valor_total,
            data_venda: v.data_venda,
            produtos: v.dados_completos,
            meio_envio: v.meio_envio
        }));
        res.json(vendas);
    } catch (error) {
        console.error('Erro listarVendasSemNFE:', error);
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

// ===================== SINCRONIZAÇÃO (desabilitada no backend) =====================
async function sincronizarVendasML(req, res) {
    res.status(200).json({ success: false, message: 'Sincronize via frontend' });
}

// ===================== FUNÇÕES AUXILIARES (cancelamento) =====================
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
    const cert = certData.cert.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\r|\n/g, '');
    sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${cert}</X509Certificate></X509Data>`;
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

// ===================== ROTA DE TESTE COM XML FIXO =====================
async function testarEnvioXMLFixo(req, res) {
    console.log('📨 [TESTE] Enviando XML conhecido (que já funcionou)');
    try {
        const xmlFixo = `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="NFe41260532830261000125550010689436061080227350"><ide><cUF>41</cUF><cNF>08022735</cNF><natOp>VENDA</natOp><mod>55</mod><serie>1</serie><nNF>68943606</nNF><dhEmi>2026-05-07T12:49:03-03:00</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>4101804</cMunFG><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>0</cDV><tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>1</indPres><procEmi>0</procEmi><verProc>1.0</verProc></ide><emit><CNPJ>32830261000125</CNPJ><xNome>WHEEL TECH BICYCLING LTDA</xNome><xFant>WHEEL TECH BICYCLING</xFant><enderEmit><xLgr>RUA LOURENCO JASIOCHA</xLgr><nro>1927</nro><xBairro>CENTRO</xBairro><cMun>4101804</cMun><xMun>ARAUCARIA</xMun><UF>PR</UF><CEP>83702090</CEP><cPais>1058</cPais><xPais>BRASIL</xPais></enderEmit><IE>9087859328</IE><CRT>1</CRT></emit><dest><CPF>47840605885</CPF><xNome>Andressa Miotto</xNome><enderDest><xLgr>Rua Jardineira</xLgr><nro>156</nro><xBairro>Campina da Barra</xBairro><cMun>4101804</cMun><xMun>ARAUCARIA</xMun><UF>PR</UF><CEP>83709310</CEP><cPais>1058</cPais><xPais>BRASIL</xPais></enderDest><indIEDest>9</indIEDest></dest><det nItem="1"><prod><cProd>MLB123456</cProd><cEAN>SEM GTIN</cEAN><xProd>Bicicleta Aro 29</xProd><NCM>87149990</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>150.00</vUnCom><vProd>150.00</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib><qTrib>1</qTrib><vUnTrib>150.00</vUnTrib><indTot>1</indTot></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det><total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>150.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vTotTrib>0.00</vTotTrib><vNF>150.00</vNF></ICMSTot></total><transp><modFrete>9</modFrete></transp><pag><detPag><tPag>01</tPag><vPag>150.00</vPag></detPag></pag></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/><Reference URI="#NFe41260532830261000125550010689436061080227350"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><DigestValue>3dHSok8PS2njXCSdvJlOmSnq6XxcF4nHhHQfcosta1g=</DigestValue></Reference></SignedInfo><SignatureValue>H1+xiyRqFuJcjmAteSsDGo73UozQnKrOO+tcRUv2rvErqqnsaSiPcVExc4qnkVzdBWf6T3UgzLcMDrTV+GqM62Rpl2lxuCy0o9n2quwM2Gw5vGM5Lq4rBx0vVMI3IeIBsRbsa2Uv867fkgPzH0W+4BQy41E/LK9Jt4iNO6mfE95htGZfNrEUISHgE24Y7twOJq7Q1/FAvCc+9kE4qCN44ti6i67kyLS0mu9cdXENzOolNsK0v4HMQ/CTygR0JNNT/Cv6mvy/cYRnhaPTMyq+Ig7/MXBRpQvs3/+DuSgSxh6+o36+GT5Ke0t58N7VCr8/UqOMpqMvzHtKpm4tMmAy8Q==</SignatureValue><KeyInfo><X509Data><X509Certificate>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</X509Certificate></X509Data></KeyInfo></Signature></NFe>`;

        const certData = loadCertificates();
        const nfeService = new NFEService('homologacao');
        const resposta = await nfeService.sendNFe(xmlFixo, certData);
        const protocolo = extrairProtocolo(resposta);
        
        res.json({
            success: !!protocolo,
            protocolo: protocolo || null,
            cStat: resposta.match(/<cStat>(\d+)<\/cStat>/)?.[1],
            xMotivo: resposta.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1],
            respostaCompleta: resposta.substring(0, 1500)
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
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
    buscarXMLPorChave,
    testarEnvioXMLFixo
};