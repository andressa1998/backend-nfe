function calcularDV(chaveSemDV) {
    const multiplicadores = [2, 3, 4, 5, 6, 7, 8, 9];
    let soma = 0;
    let pos = 0;
    for (let i = chaveSemDV.length - 1; i >= 0; i--) {
        const digito = parseInt(chaveSemDV.charAt(i), 10);
        const mult = multiplicadores[pos % multiplicadores.length];
        soma += digito * mult;
        pos++;
    }
    const resto = soma % 11;
    return (resto === 0 || resto === 1) ? 0 : 11 - resto;
}

function gerarXmlNfe(dados) {
    const {
        nNF,
        serie = 1,
        cNF = String(Math.floor(Math.random() * 100000000)).padStart(8, '0'),
        tpAmb = '1', // PRODUÇÃO
        emitente = {
            CNPJ: '32830261000125',
            xNome: 'Wheel Tech Bicycling Ltda',
            xFant: 'Wheel Tech Bicycling',
            IE: '9087859328',
            CRT: '1',
            IM: 'PR',
            CNAE: '4763603',
            fone: '4131501230',
            enderEmit: {
                xLgr: 'R. Lourenco Jasiocha',
                nro: '1927',
                xBairro: 'Centro',
                cMun: '4101804',
                xMun: 'Araucaria',
                UF: 'PR',
                CEP: '83702090',
                cPais: '1058',
                xPais: 'BRASIL'
            }
        },
        destinatario,
        produtos,
        cfop,
        natOp = 'Venda',
        modFrete = '2',
        venda_id = null
    } = dados;

    if (!destinatario || !destinatario.xNome) {
        throw new Error('Destinatário não informado corretamente');
    }

    const agora = new Date();
    const dhEmi = agora.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T') + '-03:00';
    const dhSaiEnt = dhEmi;
    const ano = agora.getFullYear().toString().slice(-2);
    const mes = (agora.getMonth() + 1).toString().padStart(2, '0');
    const cUF = '41';

    const chaveSemDV = cUF + ano + mes + emitente.CNPJ + '55' +
        serie.toString().padStart(3, '0') +
        nNF.toString().padStart(9, '0') +
        '1' + cNF;

    const cDV = calcularDV(chaveSemDV);
    const idNFe = `NFe${chaveSemDV}${cDV}`;

    let documento = destinatario.CPF || destinatario.CNPJ;
    const tipoDoc = documento.length === 14 ? 'CNPJ' : 'CPF';

    let totalProd = 0;
    let produtosXml = '';
    produtos.forEach((prod, idx) => {
        const vProd = prod.quantidade * prod.valor_unitario;
        totalProd += vProd;
        produtosXml += `
        <det nItem="${idx + 1}">
            <prod>
                <cProd>${prod.sku || ''}</cProd>
                <cEAN>SEM GTIN</cEAN>
                <xProd>${(prod.nome || '').replace(/[&<>]/g, '')}</xProd>
                <NCM>${prod.ncm || '87149990'}</NCM>
                <CFOP>${cfop}</CFOP>
                <uCom>PC</uCom>
                <qCom>${prod.quantidade.toFixed(4)}</qCom>
                <vUnCom>${prod.valor_unitario.toFixed(5)}</vUnCom>
                <vProd>${vProd.toFixed(2)}</vProd>
                <cEANTrib>SEM GTIN</cEANTrib>
                <uTrib>PC</uTrib>
                <qTrib>${prod.quantidade.toFixed(4)}</qTrib>
                <vUnTrib>${prod.valor_unitario.toFixed(5)}</vUnTrib>
                <indTot>1</indTot>
            </prod>
            <imposto>
                <vTotTrib>0.00</vTotTrib>
                <ICMS>
                    <ICMSSN102>
                        <orig>0</orig>
                        <CSOSN>102</CSOSN>
                    </ICMSSN102>
                </ICMS>
                <PIS>
                    <PISOutr>
                        <CST>49</CST>
                        <vBC>${vProd.toFixed(2)}</vBC>
                        <pPIS>0.0000</pPIS>
                        <vPIS>0.00</vPIS>
                    </PISOutr>
                </PIS>
                <COFINS>
                    <COFINSOutr>
                        <CST>49</CST>
                        <vBC>${vProd.toFixed(2)}</vBC>
                        <pCOFINS>0.0000</pCOFINS>
                        <vCOFINS>0.00</vCOFINS>
                    </COFINSOutr>
                </COFINS>
            </imposto>
        </det>`;
    });

    const nNFStr = nNF.toString();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe versao="4.00" Id="${idNFe}">
        <ide>
            <cUF>${cUF}</cUF>
            <cNF>${cNF}</cNF>
            <natOp>${natOp}</natOp>
            <mod>55</mod>
            <serie>${serie}</serie>
            <nNF>${nNF}</nNF>
            <dhEmi>${dhEmi}</dhEmi>
            <dhSaiEnt>${dhSaiEnt}</dhSaiEnt>
            <tpNF>1</tpNF>
            <idDest>${destinatario.UF === emitente.enderEmit.UF ? '1' : '2'}</idDest>
            <cMunFG>${emitente.enderEmit.cMun}</cMunFG>
            <tpImp>1</tpImp>
            <tpEmis>1</tpEmis>
            <cDV>${cDV}</cDV>
            <tpAmb>${tpAmb}</tpAmb>
            <finNFe>1</finNFe>
            <indFinal>1</indFinal>
            <indPres>0</indPres>
            <procEmi>0</procEmi>
            <verProc>0</verProc>
        </ide>
        <emit>
            <CNPJ>${emitente.CNPJ}</CNPJ>
            <xNome>${emitente.xNome}</xNome>
            <xFant>${emitente.xFant}</xFant>
            <enderEmit>
                <xLgr>${emitente.enderEmit.xLgr}</xLgr>
                <nro>${emitente.enderEmit.nro}</nro>
                <xBairro>${emitente.enderEmit.xBairro}</xBairro>
                <cMun>${emitente.enderEmit.cMun}</cMun>
                <xMun>${emitente.enderEmit.xMun}</xMun>
                <UF>${emitente.enderEmit.UF}</UF>
                <CEP>${emitente.enderEmit.CEP}</CEP>
                <cPais>${emitente.enderEmit.cPais}</cPais>
                <xPais>${emitente.enderEmit.xPais}</xPais>
                <fone>${emitente.fone}</fone>
            </enderEmit>
            <IE>${emitente.IE}</IE>
            <IM>${emitente.IM}</IM>
            <CNAE>${emitente.CNAE}</CNAE>
            <CRT>${emitente.CRT}</CRT>
        </emit>
        <dest>
            <${tipoDoc}>${documento}</${tipoDoc}>
            <xNome>${destinatario.xNome}</xNome>
            <enderDest>
                <xLgr>${destinatario.xLgr}</xLgr>
                <nro>${destinatario.nro}</nro>
                <xBairro>${destinatario.xBairro}</xBairro>
                <cMun>${destinatario.cMun}</cMun>
                <xMun>${destinatario.xMun}</xMun>
                <UF>${destinatario.UF}</UF>
                <CEP>${destinatario.CEP}</CEP>
                <cPais>1058</cPais>
                <xPais>BRASIL</xPais>
            </enderDest>
            <indIEDest>9</indIEDest>
        </dest>
        ${produtosXml}
        <total>
            <ICMSTot>
                <vBC>0.00</vBC>
                <vICMS>0.00</vICMS>
                <vICMSDeson>0.00</vICMSDeson>
                <vFCP>0.00</vFCP>
                <vBCST>0.00</vBCST>
                <vST>0</vST>
                <vFCPST>0.00</vFCPST>
                <vFCPSTRet>0.00</vFCPSTRet>
                <vProd>${totalProd.toFixed(2)}</vProd>
                <vFrete>0.00</vFrete>
                <vSeg>0.00</vSeg>
                <vDesc>0.00</vDesc>
                <vII>0.00</vII>
                <vIPI>0.00</vIPI>
                <vIPIDevol>0.00</vIPIDevol>
                <vPIS>0.00</vPIS>
                <vCOFINS>0.00</vCOFINS>
                <vOutro>0.00</vOutro>
                <vNF>${totalProd.toFixed(2)}</vNF>
                <vTotTrib>0.00</vTotTrib>
            </ICMSTot>
        </total>
        <transp>
            <modFrete>${modFrete}</modFrete>
        </transp>
        <cobr>
            <fat>
                <nFat>${nNFStr}</nFat>
                <vOrig>${totalProd.toFixed(2)}</vOrig>
                <vDesc>0.00</vDesc>
                <vLiq>${totalProd.toFixed(2)}</vLiq>
            </fat>
        </cobr>
        <pag>
            <detPag>
                <indPag>0</indPag>
                <tPag>01</tPag>
                <vPag>${totalProd.toFixed(2)}</vPag>
            </detPag>
            <vTroco>0.00</vTroco>
        </pag>
        <infAdic>
            <infCpl>I - "DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL";II - "NAO GERA DIREITO A CREDITO FISCAL DE ICMS, DE ISS E DE IPI".|Valor aproximado dos tributos: |R$ 35,87 federais|R$ 46,11 estaduais|Fonte: IBPT/empresometro.com.br 92589A|</infCpl>
        </infAdic>
        <infRespTec>
            <CNPJ>64555626000147</CNPJ>
            <xContato>MARIA ANTONIA MELO COSTA</xContato>
            <email>privacidade@iob.com.br</email>
            <fone>1930043303</fone>
            <idCSRT>01</idCSRT>
            <hashCSRT>e+lX/2M6s4ch9hsc8f39dYz/Abs=</hashCSRT>
        </infRespTec>
    </infNFe>
</NFe>`;

    return xml;
}

module.exports = { gerarXmlNfe };