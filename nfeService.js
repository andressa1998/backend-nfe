const axios = require('axios');
const https = require('https');

class NFEService {
    constructor(ambiente = 'homologacao') {
        this.ambiente = ambiente;
        if (ambiente === 'producao') {
            this.urlAutorizacao = 'https://nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4';
            this.urlEvento = 'https://nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4';
            this.urlConsulta = 'https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4';
        } else {
            this.urlAutorizacao = 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4';
            this.urlEvento = 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4';
            this.urlConsulta = 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4';
        }
    }

    // Função auxiliar para limpar o XML e evitar caracteres problemáticos
    _cleanXml(xml) {
        return xml
            .replace(/<\?xml.*?\?>/g, '')          // remove declaração XML
            .replace(/\r?\n/g, '')                 // remove quebras de linha
            .replace(/\t/g, '')                    // remove tabs
            .replace(/>\s+</g, '><')               // remove espaços entre tags
            .trim();
    }

    async sendNFe(xmlAssinado, certData) {
        // Cria o agente HTTPS com o certificado e a cadeia (se existir)
        const httpsAgent = new https.Agent({
            cert: certData.cert,
            key: certData.privateKey,
            ca: certData.ca || undefined,          // inclui a cadeia de certificados
            rejectUnauthorized: false,             // homologação não exige validação estrita
            secureProtocol: 'TLSv1_2_method',
            ciphers: 'DEFAULT@SECLEVEL=1'
        });

        // Limpa o XML para envio
        let xmlLimpo = this._cleanXml(xmlAssinado);

        // Monta o envelope SOAP de acordo com o padrão da SEFAZ (versão 1.1)
        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <soap:Body>
        <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
            ${xmlLimpo}
        </nfeDadosMsg>
    </soap:Body>
</soap:Envelope>`;

        try {
            const response = await axios.post(this.urlAutorizacao, soapEnvelope, {
                httpsAgent,
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeDadosMsg'
                },
                timeout: 60000
            });
            return response.data;
        } catch (error) {
            console.error('❌ Erro ao enviar NF-e para SEFAZ:', error.message);
            if (error.response) {
                console.error('Resposta da SEFAZ (erro HTTP):', error.response.data);
            }
            throw error;
        }
    }

    async sendEvento(xmlAssinado, certData) {
        const httpsAgent = new https.Agent({
            cert: certData.cert,
            key: certData.privateKey,
            ca: certData.ca || undefined,
            rejectUnauthorized: false,
            secureProtocol: 'TLSv1_2_method',
            ciphers: 'DEFAULT@SECLEVEL=1'
        });

        let xmlLimpo = this._cleanXml(xmlAssinado);

        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <soap:Body>
        <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">
            ${xmlLimpo}
        </nfeDadosMsg>
    </soap:Body>
</soap:Envelope>`;

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

    async consultarStatus(chaveAcesso, certData) {
        const httpsAgent = new https.Agent({
            cert: certData.cert,
            key: certData.privateKey,
            ca: certData.ca || undefined,
            rejectUnauthorized: false,
            secureProtocol: 'TLSv1_2_method',
            ciphers: 'DEFAULT@SECLEVEL=1'
        });

        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <soap:Body>
        <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">
            <consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
                <tpAmb>${this.ambiente === 'producao' ? '1' : '2'}</tpAmb>
                <xServ>CONSULTAR</xServ>
                <chNFe>${chaveAcesso}</chNFe>
            </consSitNFe>
        </nfeDadosMsg>
    </soap:Body>
</soap:Envelope>`;

        const response = await axios.post(this.urlConsulta, soapEnvelope, {
            httpsAgent,
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeDadosMsg'
            },
            timeout: 30000
        });
        return response.data;
    }
}

module.exports = NFEService;