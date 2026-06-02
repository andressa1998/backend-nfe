function extrairProtocolo(respostaXml) {
    // Procura <nProt> com ou sem namespace
    let match = respostaXml.match(/<nProt[^>]*>(\d+)<\/nProt>/i);
    if (match) return match[1];
    
    // Se não encontrou protocolo, tenta extrair cStat e xMotivo (erro)
    const cStatMatch = respostaXml.match(/<cStat[^>]*>(\d+)<\/cStat>/i);
    const xMotivoMatch = respostaXml.match(/<xMotivo[^>]*>([^<]+)<\/xMotivo>/i);
    if (cStatMatch && cStatMatch[1] !== '100') {
        const erro = `cStat=${cStatMatch[1]}, motivo=${xMotivoMatch ? xMotivoMatch[1] : 'desconhecido'}`;
        console.error(`❌ SEFAZ retornou erro: ${erro}`);
        throw new Error(`SEFAZ rejeitou a NF-e: ${erro}`);
    }
    return null;
}

function extrairChaveAcesso(xmlAssinado) {
    const match = xmlAssinado.match(/Id="([^"]+)"/);
    return match ? match[1].replace('NFe', '') : null;
}

module.exports = { extrairProtocolo, extrairChaveAcesso };