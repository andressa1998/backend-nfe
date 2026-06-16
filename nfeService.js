// nfeService.js
const axios = require('axios');
const https = require('https');

class NFEService {
    constructor(ambiente = 'producao') {
        this.ambiente = ambiente;
        if (ambiente === 'homologacao') {
            this.urlAutorizacao = 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4';
            this.urlEvento = 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4';
            this.urlConsulta = 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4';
        } else {
            this.urlAutorizacao = 'https://nfe.sefa.pr.gov.br/nfe/NFeAutorizacao4';
            this.urlEvento = 'https://nfe.sefa.pr.gov.br/nfe/NFeRecepcaoEvento4';
            this.urlConsulta = 'https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4';
        }
    }

    // ❌ REMOVIDA a função _cleanXml – não vamos mais limpar o XML assinado

    async sendNFe(xmlAssinado, certData) {
        // Envelope SOAP sem modificar o XML assinado
        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <soap:Body>
        <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">
            ${xmlAssinado}
        </nfeDadosMsg>
    </soap:Body>
</soap:Envelope>`;

        const httpsAgent = new https.Agent({
            cert: certData.cert,
            key: certData.privateKey,
            ca: certData.ca || undefined,
            rejectUnauthorized: false,
            secureProtocol: 'TLSv1_2_method',
            ciphers: 'DEFAULT@SECLEVEL=1'
        });

        console.log('📨 Enviando para SEFAZ URL:', this.urlAutorizacao);
        console.log('📄 Envelope SOAP (primeiros 800 caracteres):', soapEnvelope.substring(0, 800));

        try {
            const response = await axios.post(this.urlAutorizacao, soapEnvelope, {
                httpsAgent,
                headers: {
                    'Content-Type': 'text/xml; charset=utf-8',
                    'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeDadosMsg'
                },
                timeout: 60000
            });

            console.log('✅ Resposta da SEFAZ (status):', response.status);
            console.log('📄 Resposta completa:', response.data);

            // Extrai cStat e xMotivo para debug
            const cStat = response.data.match(/<cStat>(\d+)<\/cStat>/)?.[1] || 'N/A';
            const xMotivo = response.data.match(/<xMotivo>([^<]+)<\/xMotivo>/)?.[1] || 'N/A';
            console.log(`📊 cStat=${cStat}, xMotivo=${xMotivo}`);

            return response.data;
        } catch (error) {
            console.error('❌ Erro no envio para SEFAZ:');
            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Dados:', error.response.data);
            } else {
                console.error(error.message);
            }
            throw error;
        }
    }

    // Os métodos sendEvento e consultarStatus permanecem iguais, mas com a mesma lógica (sem limpeza)
    async sendEvento(xmlAssinado, certData) {
        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
        <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">
            ${xmlAssinado}
        </nfeDadosMsg>
    </soap:Body>
</soap:Envelope>`;

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

    async consultarStatus(chaveAcesso, certData) {
        const tpAmb = this.ambiente === 'producao' ? '1' : '2';
        const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
        <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">
            <consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
                <tpAmb>${tpAmb}</tpAmb>
                <xServ>CONSULTAR</xServ>
                <chNFe>${chaveAcesso}</chNFe>
            </consSitNFe>
        </nfeDadosMsg>
    </soap:Body>
</soap:Envelope>`;

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