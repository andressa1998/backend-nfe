const forge = require('node-forge');

function loadCertificates() {
    // Lê as variáveis de ambiente
    const pfxBase64 = process.env.PFX_BASE64;
    const pfxPassword = process.env.PFX_PASSWORD;

    if (!pfxBase64 || !pfxPassword) {
        throw new Error('Certificado não configurado nas variáveis de ambiente (PFX_BASE64 e PFX_PASSWORD)');
    }

    const pfxBuffer = Buffer.from(pfxBase64, 'base64');
    const p12Asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, pfxPassword);

    // Chave privada
    const bags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    if (!bags[forge.pki.oids.pkcs8ShroudedKeyBag] || bags[forge.pki.oids.pkcs8ShroudedKeyBag].length === 0) {
        throw new Error('Chave privada não encontrada no PFX');
    }
    const privateKey = forge.pki.privateKeyToPem(bags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key);

    // Certificado
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (!certBags[forge.pki.oids.certBag] || certBags[forge.pki.oids.certBag].length === 0) {
        throw new Error('Certificado não encontrado no PFX');
    }
    const cert = forge.pki.certificateToPem(certBags[forge.pki.oids.certBag][0].cert);

    // Cadeia de certificados (opcional)
    let ca = null;
    if (certBags[forge.pki.oids.certBag].length > 1) {
        ca = certBags[forge.pki.oids.certBag].slice(1).map(c => forge.pki.certificateToPem(c.cert)).join('');
    }

    return { privateKey, cert, ca };
}

module.exports = { loadCertificates };