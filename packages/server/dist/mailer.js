import { getDb } from './db.js';
import { config } from './config.js';
export async function sendOperationalEmail(input) {
    if (!config.isProduction && process.env.QUICKGLIMPSE_EMAIL_DELIVERY_ENABLED !== 'true') {
        return { delivered: false, reason: 'non_production_delivery_disabled' };
    }
    const db = getDb();
    const smtp = db
        .prepare('SELECT username, password, send_address AS sendAddress, server_address AS serverAddress, port, secure_login_type AS secureLoginType FROM smtp_settings WHERE id = 1')
        .get();
    if (!smtp?.serverAddress || !smtp.username || !smtp.sendAddress) {
        return { delivered: false, reason: 'smtp_not_configured' };
    }
    const { createTransport } = await import('nodemailer');
    const transport = createTransport({
        host: smtp.serverAddress,
        port: smtp.port,
        secure: smtp.secureLoginType === 'ssl',
        auth: {
            user: smtp.username,
            pass: smtp.password,
        },
        ...(smtp.secureLoginType === 'starttls' ? { requireTLS: true } : {}),
    });
    await transport.sendMail({
        from: smtp.sendAddress,
        to: input.to,
        subject: input.subject,
        text: input.text,
    });
    return { delivered: true };
}
