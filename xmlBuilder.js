// xmlBuilder.js
function escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

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
        tpAmb = '2', // '1' para produção
        emitente = {
            CNPJ: '32830261000125',
            xNome: 'Wheel Tech Bicycling Ltda',
            xFant: 'Wheel Tech Bicycling',
            IE: '9087859328',
            CRT: '1',
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
        modFrete = '9'
    } = dados;

    if (!destinatario || !destinatario.xNome) {
        throw new Error('Destinatário não informado corretamente');
    }

    const agora = new Date();
    const dhEmi = agora.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T') + '-03:00';
    const dhSaiEnt = dhEmi;
    const ano = agora.getFullYear().toString().slice(-2);
    const mes = (agora.getMonth() + 1).toString().padStart(2, '0');
    const cUF = '41'; // Paraná

    const chaveSemDV = cUF + ano + mes + emitente.CNPJ + '55' +
        serie.toString().padStart(3, '0') +
        nNF.toString().padStart(9, '0') +
        '1' + cNF;

    const cDV = calcularDV(chaveSemDV);
    const idNFe = `NFe${chaveSemDV}${cDV}`;

    let documento = (destinatario.CPF || destinatario.CNPJ || '').replace(/\D/g, '');
    const tipoDoc = documento.length === 14 ? 'CNPJ' : 'CPF';

    let totalProd = 0;
    let produtosXml = '';
    produtos.forEach((prod, idx) => {
        const vProd = prod.quantidade * prod.valor_unitario;
        totalProd += vProd;
        const nomeProd = escapeXml(prod.nome || '');
        const sku = escapeXml(prod.sku || '');
        produtosXml += `
        <det nItem="${idx + 1}">
            <prod>
                <cProd>${sku}</cProd>
                <cEAN>SEM GTIN</cEAN>
                <xProd>${nomeProd}</xProd>
                <NCM>${prod.ncm || '87149990'}</NCM>
                <CFOP>${cfop}</CFOP>
                <uCom>UN</uCom>
                <qCom>${prod.quantidade.toFixed(4)}</qCom>
                <vUnCom>${prod.valor_unitario.toFixed(2)}</vUnCom>
                <vProd>${vProd.toFixed(2)}</vProd>
                <cEANTrib>SEM GTIN</cEANTrib>
                <uTrib>UN</uTrib>
                <qTrib>${prod.quantidade.toFixed(4)}</qTrib>
                <vUnTrib>${prod.valor_unitario.toFixed(2)}</vUnTrib>
                <indTot>1</indTot>
            </prod>
            <imposto>
                <ICMS>
                    <ICMSSN102>
                        <orig>0</orig>
                        <CSOSN>102</CSOSN>
                    </ICMSSN102>
                </ICMS>
                <PIS>
                    <PISNT>
                        <CST>07</CST>
                    </PISNT>
                </PIS>
                <COFINS>
                    <COFINSNT>
                        <CST>07</CST>
                    </COFINSNT>
                </COFINS>
            </imposto>
        </det>`;
    });

    // Escapar campos do emitente e destinatário
    const xNomeEmit = escapeXml(emitente.xNome);
    const xFantEmit = escapeXml(emitente.xFant);
    const xLgrEmit = escapeXml(emitente.enderEmit.xLgr);
    const xBairroEmit = escapeXml(emitente.enderEmit.xBairro);
    const xMunEmit = escapeXml(emitente.enderEmit.xMun);

    const xNomeDest = escapeXml(destinatario.xNome);
    const xLgrDest = escapeXml(destinatario.xLgr || '');
    const nroDest = escapeXml(destinatario.nro || 'S/N');
    const xBairroDest = escapeXml(destinatario.xBairro || '');
    const xMunDest = escapeXml(destinatario.xMun || '');
    const cMunDest = destinatario.cMun || '4101804';

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe versao="4.00" Id="${idNFe}">
        <ide>
            <cUF>${cUF}</cUF>
            <cNF>${cNF}</cNF>
            <natOp>${escapeXml(natOp)}</natOp>
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
            <indPres>1</indPres>
            <procEmi>0</procEmi>
            <verProc>1.0</verProc>
        </ide>
        <emit>
            <CNPJ>${emitente.CNPJ}</CNPJ>
            <xNome>${xNomeEmit}</xNome>
            <xFant>${xFantEmit}</xFant>
            <enderEmit>
                <xLgr>${xLgrEmit}</xLgr>
                <nro>${emitente.enderEmit.nro}</nro>
                <xBairro>${xBairroEmit}</xBairro>
                <cMun>${emitente.enderEmit.cMun}</cMun>
                <xMun>${xMunEmit}</xMun>
                <UF>${emitente.enderEmit.UF}</UF>
                <CEP>${emitente.enderEmit.CEP}</CEP>
                <cPais>${emitente.enderEmit.cPais}</cPais>
                <xPais>${escapeXml(emitente.enderEmit.xPais)}</xPais>
                <fone>${emitente.fone}</fone>
            </enderEmit>
            <IE>${emitente.IE}</IE>
            <CRT>${emitente.CRT}</CRT>
        </emit>
        <dest>
            <${tipoDoc}>${documento}</${tipoDoc}>
            <xNome>${xNomeDest}</xNome>
            <enderDest>
                <xLgr>${xLgrDest}</xLgr>
                <nro>${nroDest}</nro>
                <xBairro>${xBairroDest}</xBairro>
                <cMun>${cMunDest}</cMun>
                <xMun>${xMunDest}</xMun>
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
                <vST>0.00</vST>
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
        <pag>
            <detPag>
                <tPag>01</tPag>
                <vPag>${totalProd.toFixed(2)}</vPag>
            </detPag>
        </pag>
    </infNFe>
</NFe>`;

    return xml;
}

module.exports = { gerarXmlNfe };