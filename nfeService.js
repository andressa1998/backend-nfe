const axios = require('axios');
const https = require('https');

class NFEService {
    constructor(ambiente = 'producao') {
        this.ambiente = ambiente;
        // URLs de produção (fixas)
        this.urlAutorizacao = 'https://nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4';
        this.urlEvento = 'https://nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4';
        this.urlConsulta = 'https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4';
    }

    // Limpa o XML para envio (remove declaração, quebras de linha, tabs, espaços entre tags)
    _cleanXml(xml) {
        return xml
            .replace(/<\?xml.*?\?>/g, '')
            .replace(/\r?\n/g, '')
            .replace(/\t/g, '')
            .replace(/>\s+</g, '><')
            .trim();
    }

    // Envio de NF-e
    async sendNFe(xmlAssinado, certData) {
        const xmlLimpo = this._cleanXml(xmlAssinado);

        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">${xmlLimpo}</nfeDadosMsg></soap:Body></soap:Envelope>`;

        const httpsAgent = new https.Agent({
            cert: certData.cert,
            key: certData.privateKey,
            ca: certData.ca || undefined,
            rejectUnauthorized: false,
            secureProtocol: 'TLSv1_2_method',
            ciphers: 'DEFAULT@SECLEVEL=1'
        });

        const response = await axios.post(this.urlAutorizacao, soapEnvelope, {
            httpsAgent,
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeDadosMsg'
            },
            timeout: 60000
        });
        return response.data;
    }

    // Envio de evento de cancelamento
    async sendEvento(xmlAssinado, certData) {
        const xmlLimpo = this._cleanXml(xmlAssinado);
        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">${xmlLimpo}</nfeDadosMsg></soap:Body></soap:Envelope>`;

        const httpsAgent = new https.Agent({
            cert: certData.cert,
            key: certData.privateKey,
            ca: certData.ca || undefined,
            rejectUnauthorized: false,
            secureProtocol: 'TLSv1_2_method',
            ciphers: 'DEFAULT@SECLEVEL=1'
        });

        const response = await axios.post(this.urlEvento, soapEnvelope, {
            httpsAgent,
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeDadosMsg'
            },
            timeout: 60000
        });
        return response.data;
    }

    // Consulta de situação da NF-e
    async consultarStatus(chaveAcesso, certData) {
        const tpAmb = this.ambiente === 'producao' ? '1' : '2';
        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4"><consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>${tpAmb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chaveAcesso}</chNFe></consSitNFe></nfeDadosMsg></soap:Body></soap:Envelope>`;

        const httpsAgent = new https.Agent({
            cert: certData.cert,
            key: certData.privateKey,
            ca: certData.ca || undefined,
            rejectUnauthorized: false,
            secureProtocol: 'TLSv1_2_method',
            ciphers: 'DEFAULT@SECLEVEL=1'
        });

        const response = await axios.post(this.urlConsulta, soapEnvelope, {
            httpsAgent,
            headers: {
                'Content-Type': 'text/xml; charset=utf-8'
            },
            timeout: 30000
        });
        return response.data;
    }
}

module.exports = NFEService;