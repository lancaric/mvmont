const labels = { frameless: 'Bezrámové presklenia', framed: 'Rámové presklenia', shutters: 'Rolety', blinds: 'Žalúzie', terraces: 'Terasy', railings: 'Balkónové zábradlia', screens: 'Siete proti hmyzu' };
export async function sendContactEmails(entry, env, transport = fetch) {
  if (!env.RESEND_API_KEY || !env.CONTACT_TO || !env.CONTACT_FROM) return { company: 'failed', customer: 'failed', status: 'failed' };
  const company = env.COMPANY_NAME || 'MV-MONT';
  const service = labels[entry.service] || entry.service;
  const messages = [
    { to: env.CONTACT_TO, subject: `Nový kontakt z webu (${company})`, text: [
      `Meno: ${entry.name}`, `E-mail: ${entry.email}`, `Telefón: ${entry.phone}`, `Typ služby: ${service}`, '', 'Správa:', entry.message, '', `Čas odoslania: ${entry.createdAt}`,
    ].join('\n') },
    { to: entry.email, subject: `Potvrdenie prijatia správy (${company})`, text: [
      `Dobrý deň ${entry.name},`, '', 'Ďakujeme za Vašu správu. Potvrdzujeme jej prijatie a čoskoro sa Vám ozveme.', '', 'Zhrnutie:', `Typ služby: ${service}`, `Telefón: ${entry.phone}`, '', 'Vaša správa:', entry.message, '', 'S pozdravom,', company,
    ].join('\n') },
  ];
  // Sequential calls respect low provider rate limits; failure of one does not skip the other.
  const statuses = [];
  for (const [index, message] of messages.entries()) {
    try {
      const response = await transport('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `contact/${entry.id}/${index}` },
        body: JSON.stringify({ ...message, from: env.CONTACT_FROM, reply_to: env.CONTACT_TO }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json().catch(() => ({}));
      statuses.push(response.ok && typeof data.id === 'string' ? 'sent' : 'failed');
    } catch { statuses.push('failed'); }
  }
  return { company: statuses[0], customer: statuses[1], status: statuses.every(s => s === 'sent') ? 'sent' : statuses.every(s => s === 'failed') ? 'failed' : 'partial' };
}
