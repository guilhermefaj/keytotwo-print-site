import { LegalPage } from '../components/legal/LegalPage'
import { legal } from '../content/legal'

// Política de reembolso: página própria, ligada no rodapé, na loja, na sacola e no aceite do pagamento.
export default function Reembolsos() { return <LegalPage content={legal.reembolso} /> }
