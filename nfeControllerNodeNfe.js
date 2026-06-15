// nfeControllerNodeNfe.js
const { NFe, AMBIENTE_HOMOLOGACAO } = require('node-nfe');
const supabase = require('./supabaseClient');

// Função auxiliar para obter o próximo número da NF
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
        // Fallback para não travar
        return Math.floor(Math.random() * 900000000) + 100000000;
    }
}

async function emitirNFe(req, res) {
    console.log('📨 [node-nfe] Requisição de emissão recebida');
    
    try {
        const { cliente, produtos, cfop, natureza_operacao, modalidade_frete, venda_id } = req.body;

        // Validações básicas
        if (!cliente || !produtos || produtos.length === 0) {
            return res.status(400).json({ error: 'Dados incompletos: cliente e produtos são obrigatórios' });
        }

        // Obtém o próximo número da NF
        const nNF = await getNextNFNumber();
        console.log(`✅ Número NF alocado: ${nNF}`);

        // Configura o certificado a partir das variáveis de ambiente
        const pfxBase64 = process.env.PFX_BASE64;
        const pfxPassword = process.env.PFX_PASSWORD;

        if (!pfxBase64 || !pfxPassword) {
            throw new Error('Certificado não configurado: PFX_BASE64 e PFX_PASSWORD são obrigatórios');
        }

        const pfxBuffer = Buffer.from(pfxBase64, 'base64');

        const nfe = new NFe({
            ambiente: AMBIENTE_HOMOLOGACAO,
            certificado: {
                pfx: pfxBuffer,
                senha: pfxPassword
            }
        });

        // Prepara os dados da NF-e conforme estrutura da node-nfe
        const valorTotal = produtos.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0);
        const isMesmaUF = (cliente.uf === 'PR');
        const cfopFinal = cfop || (isMesmaUF ? '5102' : '6108');

        // Limpa documento (CPF/CNPJ)
        let documento = (cliente.documento || '').replace(/\D/g, '');
        if (!documento || (documento.length !== 11 && documento.length !== 14)) {
            console.warn('⚠️ Documento inválido, usando CPF genérico para homologação');
            documento = '99999999999';
        }
        const isCPF = documento.length === 11;

        // Estrutura de dados para a node-nfe
        const dadosNFe = {
            ide: {
                cUF: 41,
                natOp: natureza_operacao || 'VENDA',
                mod: 55,
                serie: 1,
                nNF: nNF,
                tpNF: 1,
                idDest: isMesmaUF ? 1 : 2,
                cMunFG: 4101804,
                tpImp: 1,
                tpEmis: 1,
                tpAmb: 2, // homologação
                finNFe: 1,
                indFinal: 1,
                indPres: 1,
                procEmi: 0,
                verProc: '1.0'
            },
            emit: {
                CNPJ: '32830261000125',
                xNome: 'WHEEL TECH BICYCLING LTDA',
                xFant: 'WHEEL TECH BICYCLING',
                IE: '9087859328',
                CRT: 1,
                enderEmit: {
                    xLgr: 'RUA LOURENCO JASIOCHA',
                    nro: '1927',
                    xBairro: 'CENTRO',
                    cMun: 4101804,
                    xMun: 'ARAUCARIA',
                    UF: 'PR',
                    CEP: 83702090,
                    cPais: 1058,
                    xPais: 'BRASIL'
                }
            },
            dest: {
                ...(isCPF ? { CPF: documento } : { CNPJ: documento }),
                xNome: cliente.nome || 'Consumidor Final',
                enderDest: {
                    xLgr: cliente.endereco || cliente.logradouro || 'NÃO INFORMADO',
                    nro: cliente.numero || 'S/N',
                    xBairro: cliente.bairro || 'CENTRO',
                    cMun: cliente.codigo_ibge || 4101804,
                    xMun: cliente.cidade || 'ARAUCARIA',
                    UF: cliente.uf || 'PR',
                    CEP: (cliente.cep || '83702090').replace(/\D/g, ''),
                    cPais: 1058,
                    xPais: 'BRASIL'
                },
                indIEDest: 9
            },
            det: produtos.map((prod, idx) => ({
                nItem: idx + 1,
                prod: {
                    cProd: prod.sku || prod.cProd || `ITEM${idx + 1}`,
                    cEAN: 'SEM GTIN',
                    xProd: prod.nome,
                    NCM: prod.ncm || '87149990',
                    CFOP: cfopFinal,
                    uCom: 'UN',
                    qCom: prod.quantidade,
                    vUnCom: prod.valor_unitario,
                    vProd: prod.quantidade * prod.valor_unitario,
                    cEANTrib: 'SEM GTIN',
                    uTrib: 'UN',
                    qTrib: prod.quantidade,
                    vUnTrib: prod.valor_unitario,
                    indTot: 1
                },
                imposto: {
                    ICMS: { ICMSSN102: { orig: 0, CSOSN: '102' } },
                    PIS: { PISNT: { CST: '07' } },
                    COFINS: { COFINSNT: { CST: '07' } }
                }
            })),
            total: {
                ICMSTot: {
                    vBC: 0,
                    vICMS: 0,
                    vICMSDeson: 0,
                    vFCP: 0,
                    vBCST: 0,
                    vST: 0,
                    vFCPST: 0,
                    vFCPSTRet: 0,
                    vProd: valorTotal,
                    vFrete: 0,
                    vSeg: 0,
                    vDesc: 0,
                    vII: 0,
                    vIPI: 0,
                    vIPIDevol: 0,
                    vPIS: 0,
                    vCOFINS: 0,
                    vOutro: 0,
                    vTotTrib: 0,
                    vNF: valorTotal
                }
            },
            transp: {
                modFrete: modalidade_frete || '9'
            },
            pag: {
                detPag: [{
                    tPag: '01',
                    vPag: valorTotal
                }]
            }
        };

        console.log('📄 Gerando XML...');
        const xml = await nfe.gerarXml(dadosNFe);
        
        console.log('📨 Enviando para SEFAZ...');
        const resultado = await nfe.enviar(xml);
        
        console.log('📨 Resposta SEFAZ:', JSON.stringify(resultado, null, 2));

        if (resultado.retorno.cStat !== '100') {
            throw new Error(`SEFAZ rejeitou: ${resultado.retorno.xMotivo} (cStat=${resultado.retorno.cStat})`);
        }

        const chaveAcesso = resultado.retorno.chNFe;
        const protocolo = resultado.retorno.nProt;

        console.log(`✅ NF-e autorizada! Protocolo: ${protocolo}, Chave: ${chaveAcesso}`);

        // Salva no Supabase
        await supabase.from('nfe_emitidas').insert({
            venda_id: venda_id || null,
            chave: chaveAcesso,
            protocolo: protocolo,
            xml: xml,
            status: 'autorizada',
            cancelada: false,
            data_emissao: new Date().toISOString(),
            transportadora_id: null,
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
        console.error('❌ Erro na emissão (node-nfe):', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = { emitirNFe };