const { NFe, AMBIENTE_PRODUCAO } = require('node-nfe');
const supabase = require('./supabaseClient');

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
        return Math.floor(Math.random() * 900000000) + 100000000;
    }
}

async function emitirNFe(req, res) {
    try {
        const { cliente, produtos, cfop, natureza_operacao, modalidade_frete, venda_id } = req.body;
        if (!cliente || !produtos || produtos.length === 0) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        const nNF = await getNextNFNumber();
        console.log(`✅ Número NF alocado: ${nNF}`);

        const pfxBuffer = Buffer.from(process.env.PFX_BASE64, 'base64');
        const pfxPassword = process.env.PFX_PASSWORD;

        const nfe = new NFe({
            ambiente: AMBIENTE_PRODUCAO,
            certificado: {
                pfx: pfxBuffer,
                senha: pfxPassword
            }
        });

        const isMesmaUF = (cliente.uf === 'PR');
        const cfopFinal = cfop || (isMesmaUF ? '5102' : '6108');
        const valorTotal = produtos.reduce((sum, p) => sum + (p.quantidade * p.valor_unitario), 0);

        const dadosNFe = {
            ide: {
                cUF: 41,
                natOp: natureza_operacao || 'Venda',
                mod: 55,
                serie: 1,
                nNF: nNF,
                tpNF: 1,
                idDest: isMesmaUF ? 1 : 2,
                cMunFG: 4101804,
                tpImp: 1,
                tpEmis: 1,
                tpAmb: 1,
                finNFe: 1,
                indFinal: 1,
                indPres: 0,
                procEmi: 0,
                verProc: '0'
            },
            emit: {
                CNPJ: '32830261000125',
                xNome: 'Wheel Tech Bicycling Ltda',
                xFant: 'Wheel Tech Bicycling',
                IE: '9087859328',
                CRT: 1,
                IM: 'PR',
                CNAE: '4763603',
                fone: '4131501230',
                enderEmit: {
                    xLgr: 'R. Lourenco Jasiocha',
                    nro: '1927',
                    xBairro: 'Centro',
                    cMun: 4101804,
                    xMun: 'Araucaria',
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
                    xBairro: cliente.bairro || 'Centro',
                    cMun: cliente.codigo_ibge || 2800308, // fallback Aracaju
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
                    CFOP: cfopFinal,
                    uCom: 'PC',
                    qCom: prod.quantidade,
                    vUnCom: prod.valor_unitario,
                    vProd: prod.quantidade * prod.valor_unitario,
                    cEANTrib: 'SEM GTIN',
                    uTrib: 'PC',
                    qTrib: prod.quantidade,
                    vUnTrib: prod.valor_unitario,
                    indTot: 1
                },
                imposto: {
                    ICMS: { ICMSSN102: { orig: 0, CSOSN: '102' } },
                    PIS: { PISOutr: { CST: '49', vBC: prod.quantidade * prod.valor_unitario, pPIS: '0.0000', vPIS: '0.00' } },
                    COFINS: { COFINSOutr: { CST: '49', vBC: prod.quantidade * prod.valor_unitario, pCOFINS: '0.0000', vCOFINS: '0.00' } }
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
            transp: { modFrete: modalidade_frete || '2' },
            cobr: { fat: { nFat: nNF.toString(), vOrig: valorTotal, vDesc: 0, vLiq: valorTotal } },
            pag: { detPag: [{ indPag: 0, tPag: '01', vPag: valorTotal }], vTroco: 0 },
            infAdic: { infCpl: 'I - "DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL";II - "NAO GERA DIREITO A CREDITO FISCAL DE ICMS, DE ISS E DE IPI".|Valor aproximado dos tributos: |R$ 35,87 federais|R$ 46,11 estaduais|Fonte: IBPT/empresometro.com.br 92589A|' },
            infRespTec: {
                CNPJ: '64555626000147',
                xContato: 'MARIA ANTONIA MELO COSTA',
                email: 'privacidade@iob.com.br',
                fone: '1930043303',
                idCSRT: '01',
                hashCSRT: 'e+lX/2M6s4ch9hsc8f39dYz/Abs='
            }
        };

        const resultado = await nfe.emitir(dadosNFe);
        console.log('Resultado node-nfe:', resultado);

        if (resultado.retorno.cStat !== '100') {
            throw new Error(`SEFAZ rejeitou: ${resultado.retorno.xMotivo} (cStat=${resultado.retorno.cStat})`);
        }

        const chaveAcesso = resultado.retorno.chNFe;
        const protocolo = resultado.retorno.nProt;

        await supabase.from('nfe_emitidas').insert({
            venda_id: venda_id || null,
            chave: chaveAcesso,
            protocolo: protocolo,
            xml: resultado.xml,
            status: 'autorizada',
            cancelada: false,
            data_emissao: new Date().toISOString(),
            valor_total: valorTotal
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
        console.error('Erro na emissão (node-nfe):', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = { emitirNFe };