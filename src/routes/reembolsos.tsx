import { redirect } from 'react-router'

export async function loader() {
  return redirect('/termos#reembolso')
}

export default function Reembolsos() { return null }
