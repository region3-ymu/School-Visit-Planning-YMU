// scripts/getCalendarToken.ts
import dotenv from 'dotenv';
import { google } from 'googleapis';
import readline from 'readline';

dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback to .env

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

const CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Faltan GOOGLE_CALENDAR_CLIENT_ID o GOOGLE_CALENDAR_CLIENT_SECRET en .env.local');
    process.exit(1);
  }

  const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('1) Abre esta URL en tu navegador:\n');
  console.log(authUrl);
  console.log('\n2) Inicia sesión con la cuenta que tiene los calendarios.');
  console.log('3) Cuando Google te muestre el código, cópialo aquí.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('Pega aquí el código de autorización: ', async (code) => {
    rl.close();
    try {
      const { tokens } = await oAuth2Client.getToken(code.trim());
      console.log('\nTokens obtenidos:\n', tokens);
      console.log('\nGUARDA este refresh_token en tu .env.local como GOOGLE_CALENDAR_REFRESH_TOKEN');
    } catch (err) {
      console.error('Error al intercambiar el código por tokens:', err);
    }
  });
}

main();
