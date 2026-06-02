// nfeService.js
const axios = require('axios');
const https = require('https');

class NFEService {
    constructor(ambiente = 'homologacao') {
        this.ambiente = ambiente;
        // URLs completas com ?wsdl
        if (ambiente === 'producao') {
            this.urlAutorizacao = 'https://nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4';
            this.urlEvento = 'https://nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4';
            this.urlConsulta = 'https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4';
        } else {
            this.urlAutorizacao = 'https://hom1.nfe.fazenda.gov.br/NFeAutorizacao/NFeAutorizacao.asmx';
            this.urlEvento = 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento/NFeRecepcaoEvento.asmx';
            this.urlConsulta = 'https://hom1.nfe.fazenda.gov.br/NFeConsultaProtocolo/NFeConsultaProtocolo.asmx';
        }
    }

    async sendNFe(xmlAssinado, certData) {
        try {
            const httpsAgent = new https.Agent({
                cert: certData.cert,
                key: certData.privateKey,
                rejectUnauthorized: false,
                secureProtocol: 'TLSv1_2_method',
                ciphers: 'DEFAULT@SECLEVEL=1'
            });

            // Remove prologo XML e espaços desnecessários
            let xmlLimpo = xmlAssinado
                .replace(/<\?xml.*?\?>/g, '')
                .replace(/\r/g, '')
                .replace(/\n/g, '')
                .replace(/\t/g, '')
                .replace(/>\s+</g, '><')
                .trim();

            // SOAP 1.1 (mais compatível)
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

            console.log('📡 Enviando NF-e para URL:', this.urlAutorizacao);
            
            const response = await axios.post(this.urlAutorizacao, soapEnvelope, {
                httpsAgent,
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeDadosMsg'
                },
                timeout: 60000
            });

            // Log da resposta (primeiros 1000 caracteres)
            console.log('📄 Resposta SEFAZ (início):', response.data.substring(0, 1000));
            return response.data;
        } catch (error) {
            console.error('❌ ERRO ao enviar NF-e para SEFAZ:', error.message);
            // Extrair resposta do erro se existir
            if (error.response) {
                console.error('📄 Resposta de erro:', error.response.data?.substring(0, 500));
            }
            throw error;
        }
    }

    async sendEvento(xmlAssinado, certData) {
        try {
            const httpsAgent = new https.Agent({
                cert: certData.cert,
                key: certData.privateKey,
                rejectUnauthorized: false,
                secureProtocol: 'TLSv1_2_method',
                ciphers: 'DEFAULT@SECLEVEL=1'
            });

            let xmlLimpo = xmlAssinado
                .replace(/<\?xml.*?\?>/g, '')
                .replace(/\r/g, '')
                .replace(/\n/g, '')
                .replace(/\t/g, '')
                .replace(/>\s+</g, '><')
                .trim();

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

            console.log('📡 Enviando evento para URL:', this.urlEvento);
            const response = await axios.post(this.urlEvento, soapEnvelope, {
                httpsAgent,
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeDadosMsg'
                },
                timeout: 60000
            });
            console.log('✅ STATUS HTTP (evento):', response.status);
            return response.data;
        } catch (error) {
            console.error('❌ ERRO ao enviar evento para SEFAZ:', error.message);
            throw error;
        }
    }

    async consultarStatus(chaveAcesso, certData) {
        try {
            const httpsAgent = new https.Agent({
                cert: certData.cert,
                key: certData.privateKey,
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
        } catch (error) {
            console.error('❌ ERRO ao consultar status na SEFAZ:', error.message);
            throw error;
        }
    }
}

module.exports = NFEService;