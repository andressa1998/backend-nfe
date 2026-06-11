const { SignedXml } = require('xml-crypto');

function assinarXml(xml, certData) {
    const sig = new SignedXml();
    sig.privateKey = certData.privateKey;
    sig.signatureAlgorithm = 'http://www.w3.org/2000/09/xmldsig#rsa-sha1';
    sig.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'; // ESSENCIAL
    sig.digestAlgorithm = 'http://www.w3.org/2000/09/xmldsig#sha1';

    sig.addReference({
        xpath: "//*[local-name(.)='infNFe']",
        transforms: [
            'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
            'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
        ],
        digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1',
        uri: ''
    });

    sig.getKeyInfoContent = function () {
        const cert = certData.cert
            .replace('-----BEGIN CERTIFICATE-----', '')
            .replace('-----END CERTIFICATE-----', '')
            .replace(/\r/g, '')
            .replace(/\n/g, '');
        return `<X509Data><X509Certificate>${cert}</X509Certificate></X509Data>`;
    };

    sig.computeSignature(xml, {
        location: { reference: "//*[local-name(.)='infNFe']", action: 'after' }
    });

    let signedXml = sig.getSignedXml();
    signedXml = signedXml.replace('<Signature>', '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
    signedXml = signedXml.replace(/xmlns=""/g, '');
    return signedXml;
}

module.exports = { assinarXml };