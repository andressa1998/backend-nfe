const { SignedXml } = require('xml-crypto');

function assinarXml(xml, certData) {
    const sig = new SignedXml();
    sig.privateKey = certData.privateKey;
    sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
    sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

    // Referência ao elemento infNFe
    sig.addReference({
        xpath: "//*[local-name(.)='infNFe']",
        transforms: [
            'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
            'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
        ],
        digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
        uri: ''
    });

    // Extrai e limpa o certificado para inserir na tag KeyInfo
    const certClean = certData.cert
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/\r?\n/g, '');
    
    sig.getKeyInfoContent = function () {
        return `<X509Data><X509Certificate>${certClean}</X509Certificate></X509Data>`;
    };

    // Aplica a assinatura logo após o elemento infNFe
    sig.computeSignature(xml, {
        location: { reference: "//*[local-name(.)='infNFe']", action: 'after' }
    });

    let signedXml = sig.getSignedXml();

    // Garante que o namespace da assinatura seja adicionado corretamente
    signedXml = signedXml.replace('<Signature>', '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
    signedXml = signedXml.replace(/xmlns=""/g, '');

    return signedXml;
}

module.exports = { assinarXml };