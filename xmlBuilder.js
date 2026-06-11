const { create } = require('xmlbuilder2');

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
        tpAmb = '2',          // 1 = produção, 2 = homologação
        emitente = {
            CNPJ: '32830261000125',
            xNome: 'WHEEL TECH BICYCLING LTDA',
            xFant: 'WHEEL TECH BICYCLING',
            IE: '9087859328',
            CRT: '1',
            enderEmit: {
                xLgr: 'RUA LOURENCO JASIOCHA',
                nro: '1927',
                xBairro: 'CENTRO',
                cMun: '4101804',
                xMun: 'ARAUCARIA',
                UF: 'PR',
                CEP: '83702090',
                cPais: '1058',
                xPais: 'BRASIL'
            }
        },
        destinatario,
        produtos,
        cfop,
        natOp = 'VENDA',
        modFrete = '9'
    } = dados;

    if (!destinatario || !destinatario.xNome) {
        throw new Error('Destinatário não informado corretamente');
    }

    const agora = new Date();
    const dhEmi = agora.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T') + '-03:00';
    const ano = agora.getFullYear().toString().slice(-2);
    const mes = (agora.getMonth() + 1).toString().padStart(2, '0');
    const cUF = '41';

    const chaveSemDV =
        cUF + ano + mes + emitente.CNPJ + '55' +
        serie.toString().padStart(3, '0') +
        nNF.toString().padStart(9, '0') +
        '1' + cNF;

    const cDV = calcularDV(chaveSemDV);
    const chaveAcesso = chaveSemDV + cDV;
    const idNFe = `NFe${chaveAcesso}`;

    const xml = create({ version: '1.0', encoding: 'UTF-8' })
        .ele('NFe', { xmlns: 'http://www.portalfiscal.inf.br/nfe' })
        .ele('infNFe', { versao: '4.00', Id: idNFe });

    // ========== IDE ==========
    const ide = xml.ele('ide');
    ide.ele('cUF').txt(cUF).up();
    ide.ele('cNF').txt(cNF).up();
    ide.ele('natOp').txt(natOp).up();
    ide.ele('mod').txt('55').up();
    ide.ele('serie').txt(String(serie)).up();
    ide.ele('nNF').txt(String(nNF)).up();
    ide.ele('dhEmi').txt(dhEmi).up();
    ide.ele('tpNF').txt('1').up();
    const idDest = (destinatario.UF === emitente.enderEmit.UF) ? '1' : '2';
    ide.ele('idDest').txt(idDest).up();
    ide.ele('cMunFG').txt(emitente.enderEmit.cMun).up();
    ide.ele('tpImp').txt('1').up();
    ide.ele('tpEmis').txt('1').up();
    ide.ele('cDV').txt(String(cDV)).up();
    ide.ele('tpAmb').txt(tpAmb).up();
    ide.ele('finNFe').txt('1').up();
    ide.ele('indFinal').txt('1').up();
    ide.ele('indPres').txt('1').up();
    ide.ele('procEmi').txt('0').up();
    ide.ele('verProc').txt('1.0').up();

    // ========== EMITENTE ==========
    const emit = xml.ele('emit');
    emit.ele('CNPJ').txt(emitente.CNPJ).up();
    emit.ele('xNome').txt(emitente.xNome).up();
    emit.ele('xFant').txt(emitente.xFant).up();
    const enderEmit = emit.ele('enderEmit');
    enderEmit.ele('xLgr').txt(emitente.enderEmit.xLgr).up();
    enderEmit.ele('nro').txt(emitente.enderEmit.nro).up();
    enderEmit.ele('xBairro').txt(emitente.enderEmit.xBairro).up();
    enderEmit.ele('cMun').txt(emitente.enderEmit.cMun).up();
    enderEmit.ele('xMun').txt(emitente.enderEmit.xMun).up();
    enderEmit.ele('UF').txt(emitente.enderEmit.UF).up();
    enderEmit.ele('CEP').txt(emitente.enderEmit.CEP).up();
    enderEmit.ele('cPais').txt(emitente.enderEmit.cPais).up();
    enderEmit.ele('xPais').txt(emitente.enderEmit.xPais).up();
    emit.ele('IE').txt(emitente.IE).up();
    emit.ele('CRT').txt(emitente.CRT).up();

    // ========== DESTINATÁRIO ==========
    const dest = xml.ele('dest');
    if (destinatario.CPF) dest.ele('CPF').txt(destinatario.CPF.replace(/\D/g, '')).up();
    else if (destinatario.CNPJ) dest.ele('CNPJ').txt(destinatario.CNPJ.replace(/\D/g, '')).up();
    else throw new Error('CPF ou CNPJ do destinatário não informado');
    dest.ele('xNome').txt(destinatario.xNome).up();

    const enderDest = dest.ele('enderDest');
    enderDest.ele('xLgr').txt(destinatario.xLgr || 'NÃO INFORMADO').up();
    enderDest.ele('nro').txt(destinatario.nro || 'S/N').up();
    if (destinatario.xBairro) enderDest.ele('xBairro').txt(destinatario.xBairro).up();
    enderDest.ele('cMun').txt(destinatario.cMun || '4101804').up();
    enderDest.ele('xMun').txt(destinatario.xMun).up();
    enderDest.ele('UF').txt(destinatario.UF).up();
    enderDest.ele('CEP').txt(destinatario.CEP || '00000000').up();
    enderDest.ele('cPais').txt('1058').up();
    enderDest.ele('xPais').txt('BRASIL').up();
    dest.ele('indIEDest').txt('9').up();

    // ========== PRODUTOS ==========
    let totalProd = 0;
    produtos.forEach((prod, idx) => {
        const det = xml.ele('det', { nItem: String(idx + 1) });
        const prodElem = det.ele('prod');
        prodElem.ele('cProd').txt(prod.sku || prod.cProd || '1').up();
        prodElem.ele('cEAN').txt('SEM GTIN').up();
        prodElem.ele('xProd').txt(prod.nome).up();
        prodElem.ele('NCM').txt(prod.ncm || '87149990').up();
        prodElem.ele('CFOP').txt(cfop).up();
        prodElem.ele('uCom').txt('UN').up();
        prodElem.ele('qCom').txt(prod.quantidade.toFixed(4)).up();
        prodElem.ele('vUnCom').txt(prod.valor_unitario.toFixed(2)).up();
        const vProd = prod.quantidade * prod.valor_unitario;
        prodElem.ele('vProd').txt(vProd.toFixed(2)).up();
        prodElem.ele('cEANTrib').txt('SEM GTIN').up();
        prodElem.ele('uTrib').txt('UN').up();
        prodElem.ele('qTrib').txt(prod.quantidade.toFixed(4)).up();
        prodElem.ele('vUnTrib').txt(prod.valor_unitario.toFixed(2)).up();
        prodElem.ele('indTot').txt('1').up();

        const imposto = det.ele('imposto');
        const icms = imposto.ele('ICMS').ele('ICMSSN102');
        icms.ele('orig').txt('0').up();
        icms.ele('CSOSN').txt('102').up();
        imposto.ele('PIS').ele('PISNT').ele('CST').txt('07').up().up().up();
        imposto.ele('COFINS').ele('COFINSNT').ele('CST').txt('07').up().up().up();

        totalProd += vProd;
    });

    // ========== TOTAL ==========
    const total = xml.ele('total').ele('ICMSTot');
    total.ele('vBC').txt('0.00').up();
    total.ele('vICMS').txt('0.00').up();
    total.ele('vICMSDeson').txt('0.00').up();
    total.ele('vFCP').txt('0.00').up();
    total.ele('vBCST').txt('0.00').up();
    total.ele('vST').txt('0.00').up();
    total.ele('vFCPST').txt('0.00').up();
    total.ele('vFCPSTRet').txt('0.00').up();
    total.ele('vProd').txt(totalProd.toFixed(2)).up();
    total.ele('vFrete').txt('0.00').up();
    total.ele('vSeg').txt('0.00').up();
    total.ele('vDesc').txt('0.00').up();
    total.ele('vII').txt('0.00').up();
    total.ele('vIPI').txt('0.00').up();
    total.ele('vIPIDevol').txt('0.00').up();
    total.ele('vPIS').txt('0.00').up();
    total.ele('vCOFINS').txt('0.00').up();
    total.ele('vOutro').txt('0.00').up();
    // CAMPO OBRIGATÓRIO (vTotTrib)
    total.ele('vTotTrib').txt('0.00').up();
    total.ele('vNF').txt(totalProd.toFixed(2)).up();

    // ========== TRANSPORTE ==========
    const transp = xml.ele('transp');
    transp.ele('modFrete').txt(modFrete).up();

    // ========== PAGAMENTO ==========
    const pag = xml.ele('pag');
    const detPag = pag.ele('detPag');
    detPag.ele('tPag').txt('01').up();
    detPag.ele('vPag').txt(totalProd.toFixed(2)).up();

    // ========== INFORMAÇÕES ADICIONAIS ==========
    const infAdic = xml.ele('infAdic');
    infAdic.ele('infCpl').txt('Sistema emissor próprio - Wheel Tech Bicycling LTDA').up();

    // ========== RESPONSÁVEL TÉCNICO ==========
    const infRespTec = xml.ele('infRespTec');
    infRespTec.ele('CNPJ').txt('32830261000125').up();
    infRespTec.ele('xContato').txt('WHEEL TECH BICYCLING LTDA').up();
    infRespTec.ele('email').txt('contato@wheeltech.com.br').up();
    infRespTec.ele('fone').txt('41999999999').up();

    const xmlString = xml.end({ prettyPrint: false });
    return xmlString;
}

module.exports = { gerarXmlNfe };