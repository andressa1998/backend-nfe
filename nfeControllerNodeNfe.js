const { NFe, AMBIENTE_HOMOLOGACAO } = require('node-nfe');
const supabase = require('./supabaseClient');

async function emitirNFeNodeNfe(req, res) {
    try {
        const { cliente, produtos, cfop, natureza_operacao, modalidade_frete, venda_id } = req.body;

        // Validações básicas
        if (!cliente || !produtos || produtos.length === 0) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        // Configura o certificado
        const pfxBuffer = Buffer.from(process.env.PFX_BASE64, 'base64');
        const nfe = new NFe({
            ambiente: AMBIENTE_HOMOLOGACAO,
            certificado: {
                pfx: pfxBuffer,
                senha: process.env.PFX_PASSWORD
            }
        });

        // Prepara os dados da NF-e (adaptar conforme sua estrutura)
        const dadosNFe = {
            ide: {
                cUF: 41,
                natOp: natureza_operacao || 'VENDA',
                mod: 55,
                serie: 1,
                nNF: await getNextNFNumber(), // função para obter próximo número
                tpNF: 1,
                idDest: (cliente.uf === 'PR') ? 1 : 2,
                cMunFG: 4101804,
                tpImp: 1,
                tpEmis: 1,
                tpAmb: 2,
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
                CPF: cliente.documento.replace(/\D/g, ''),
                xNome: cliente.nome,
                enderDest: {
                    xLgr: cliente.endereco,
                    nro: cliente.numero || 'S/N',
                    xBairro: cliente.bairro || 'CENTRO',
                    cMun: cliente.codigo_ibge || 4101804,
                    xMun: cliente.cidade,
                    UF: cliente.uf,
                    CEP: cliente.cep.replace(/\D/g, ''),
                    cPais: 1058,
                    xPais: 'BRASIL'
                },
                indIEDest: 9
            },
            det: produtos.map((prod, idx) => ({
                nItem: idx + 1,
                prod: {
                    cProd: prod.sku,
                    cEAN: 'SEM GTIN',
                    xProd: prod.nome,
                    NCM: prod.ncm || '87149990',
                    CFOP: cfop,
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
                    vProd: produtos.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0),
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
                    vNF: produtos.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0)
                }
            },
            transp: { modFrete: modalidade_frete || '9' },
            pag: { detPag: [{ tPag: '01', vPag: produtos.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0) }] }
        };

        // Gera o XML e envia
        const xml = await nfe.gerarXml(dadosNFe);
        const resultado = await nfe.enviar(xml);

        if (resultado.retorno.cStat !== '100') {
            throw new Error(`SEFAZ rejeitou: ${resultado.retorno.xMotivo} (cStat=${resultado.retorno.cStat})`);
        }

        // Salva no Supabase
        const chaveAcesso = resultado.retorno.chNFe;
        const protocolo = resultado.retorno.nProt;

        await supabase.from('nfe_emitidas').insert({
            venda_id: venda_id || null,
            chave: chaveAcesso,
            protocolo: protocolo,
            xml: xml,
            status: 'autorizada',
            cancelada: false,
            data_emissao: new Date().toISOString(),
            valor_total: dadosNFe.total.ICMSTot.vNF
        });

        if (venda_id) {
            await supabase.from('vendas_ml').update({
                nfe_emitida: true,
                nfe_chave: chaveAcesso,
                nfe_protocolo: protocolo,
                data_emissao: new Date().toISOString()
            }).eq('id', venda_id);
        }

        res.json({ success: true, protocolo, chaveAcesso });

    } catch (error) {
        console.error('❌ Erro na emissão (node-nfe):', error);
        res.status(500).json({ error: error.message });
    }
}

async function getNextNFNumber() {
    // Implementar busca do próximo número no Supabase
    const { data } = await supabase
        .from('controle_nfe')
        .select('ultimo_numero')
        .eq('serie', 1)
        .single();
    const proximo = (data?.ultimo_numero || 50000) + 1;
    await supabase
        .from('controle_nfe')
        .upsert({ serie: 1, ultimo_numero: proximo }, { onConflict: 'serie' });
    return proximo;
}

module.exports = { emitirNFeNodeNfe };