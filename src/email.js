import { escapeHtml, maskCpf } from "./security.js";

const brl = (cents) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export async function sendPurchaseConfirmation(order, idempotencyKey = `fuila-order-${order.id}`) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("O envio de e-mail do Resend ainda não está configurado.");
  }

  const names = order.participants.map((person) =>
    `${person.firstName} ${person.lastName}`.trim()
  );
  const passengerHtml = order.participants.map((person) => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #e2e8f0">
        <strong>${escapeHtml(`${person.firstName} ${person.lastName}`.trim())}</strong>
        <div style="color:#64748b;font-size:13px;margin-top:4px">
          CPF ${escapeHtml(maskCpf(person.cpf))}
        </div>
      </td>
    </tr>
  `).join("");
  const date = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "full",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(`${order.departure_date}T12:00:00-03:00`));
  const total = brl(order.total_cents);
  const subject = `Pagamento confirmado: ${order.excursion_title}`;
  const html = `
    <div style="background:#f1f5f9;padding:32px 16px;font-family:Arial,sans-serif;color:#0f172a">
      <div style="max-width:600px;margin:auto;background:#fff;border-radius:18px;overflow:hidden">
        <div style="padding:28px;background:#0ea5b7;color:#fff">
          <div style="font-size:13px;font-weight:bold;letter-spacing:1px">FUI LÁ EXCURSÕES</div>
          <h1 style="font-size:25px;margin:16px 0 8px">Pagamento confirmado!</h1>
          <p style="margin:0;color:#e6fbfd">Obrigado por escolher viajar com a gente.</p>
        </div>
        <div style="padding:28px">
          <h2 style="font-size:20px;margin:0 0 6px">${escapeHtml(order.excursion_title)}</h2>
          <p style="margin:0 0 20px;color:#64748b">${escapeHtml(date)}</p>
          <div style="background:#f8fafc;border-radius:12px;padding:16px;margin-bottom:20px">
            <div style="color:#64748b;font-size:13px">Valor confirmado</div>
            <strong style="font-size:24px;color:#0e7490">${escapeHtml(total)}</strong>
          </div>
          <h3 style="font-size:16px;margin-bottom:8px">Pessoas nesta reserva</h3>
          <table style="width:100%;border-collapse:collapse">${passengerHtml}</table>
          <p style="color:#475569;line-height:1.6;margin:24px 0 0">
            A equipe da Fui Lá Excursões agradece sua confiança. Guarde este e-mail
            como comprovante da reserva. Para dúvidas, responda a esta mensagem.
          </p>
        </div>
      </div>
    </div>`;
  const text = [
    "Fui Lá Excursões — pagamento confirmado",
    `Pacote: ${order.excursion_title}`,
    `Data: ${date}`,
    `Valor: ${total}`,
    "Pessoas:",
    ...names.map((name, index) =>
      `- ${name} — CPF ${maskCpf(order.participants[index].cpf)}`
    ),
    "",
    "Obrigado por escolher viajar com a Fui Lá Excursões.",
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: [order.contact_email],
      subject,
      html,
      text,
    }),
  });
  if (!response.ok) {
    console.error(`O Resend recusou o envio do pedido ${order.id} (HTTP ${response.status}).`);
    throw new Error("O Resend não conseguiu enviar o e-mail de confirmação.");
  }
  return response.json();
}
