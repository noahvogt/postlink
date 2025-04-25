/* postlink: fully automate printing and sending an email as physical post
Copyright © 2025 Noah Vogt noah@noahvogt.com

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>. */

const fs = require('fs');
const yaml = require('yaml');
const imaps = require('imap-simple');
const { JSDOM } = require('jsdom');
const puppeteer = require('puppeteer');
const path = require('path');
const { execSync } = require('child_process');
const PDFMerger = require('pdf-merger-js').default;
const { PDFDocument } = require('pdf-lib');
const axios = require('axios');

const ORIGINAL_HTML_FILE = 'original-infomail.html';
const CLEANED_HTML_FILE = 'cleaned-infomail.html';
const GENERAL_PDF_FILE = 'infomail.pdf';

const dryRun = process.argv.includes('--dry-run');

async function trimPdfToMaxPages(inputPath, outputPath, maxPages) {
  const fileBuffer = fs.readFileSync(inputPath);
  const pdfDoc = await PDFDocument.load(fileBuffer);
  const totalPages = pdfDoc.getPageCount();

  if (totalPages <= maxPages) {
    return;
  }

  const trimmedPdf = await PDFDocument.create();
  const copiedPages = await trimmedPdf.copyPages(pdfDoc, [...Array(maxPages).keys()]);
  copiedPages.forEach(p => trimmedPdf.addPage(p));

  const trimmedBytes = await trimmedPdf.save();
  fs.writeFileSync(outputPath, trimmedBytes);

  console.log(`pdf shorted to ${maxPages} pages.`);
}

async function uploadToPingen(pdfPath, config) {
    console.log(`uploading '${pdfPath}' to pingen.com api...`);

    // get access token
    const tokenRes = await axios.post(
        'https://identity.pingen.com/auth/access-tokens',
        new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: config.pingen.client_id,
            client_secret: config.pingen.client_secret
        }),
        {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
    );
    const token = tokenRes.data.access_token;

    // get upload url + signature
    const uploadRes = await axios.get('https://api.pingen.com/file-upload', {
        headers: { Authorization: `Bearer ${token}` }
    });
    console.log("🔎 uploadRes.data:", JSON.stringify(uploadRes.data, null, 2));
    const {
        url: uploadUrl,
        url_signature: fileUrlSignature
    } = uploadRes.data.data.attributes;

    // upload pdf
    const fileBuffer = fs.readFileSync(pdfPath);
        await axios.put(uploadUrl, fileBuffer, {
        headers: { 'Content-Type': 'application/pdf' }
    });

    // create mail object
    const response = await axios.post(
        `https://api.pingen.com/organisations/${config.pingen.organisation_id}/letters`,
        {
            data: {
                type: 'letters',
                    attributes: {
                    file_original_name: path.basename(pdfPath),
                    file_url: uploadUrl,
                    file_url_signature: fileUrlSignature,
                    address_position: 'left',
                    auto_send: true,
                    delivery_product: 'cheap',
                    print_mode: 'duplex',
                    print_spectrum: 'color'
                }
            }
        },
        {
            headers: {
                'Content-Type': 'application/vnd.api+json',
                Authorization: `Bearer ${token}`
            }
        }
    );

console.log(`✅ Brief bei Pingen angelegt: ${response.data.data.id}`);
}

const config = yaml.parse(fs.readFileSync('config.yaml', 'utf8'));
const imapConfig = {
  imap: {
    user: config.imap.user,
    password: config.imap.password,
    host: config.imap.host,
    port: config.imap.port,
    tls: config.imap.tls,
    authTimeout: 3000
  }
};


(async () => {
    const connection = await imaps.connect(imapConfig);
    await connection.openBox('INBOX');

    const searchCriteria = ['ALL'];
    const fetchOptions = { bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'], struct: true };

    const messages = await connection.search(searchCriteria, fetchOptions);

    if (messages.length === 0) {
        console.log('No emails found. Exiting...');
        await connection.end();
        return;
    }

    const latest = messages[messages.length - 1];
    const isSeen = latest.attributes.flags.includes('\\Seen');

    if (isSeen) {
        console.log('Last email in inbox already marked as read. Exiting...');
        await connection.end();
        return;
    }

    const qp = require('quoted-printable');
    const { JSDOM } = require('jsdom');

    const rawBody = latest.parts.find(part => part.which === 'TEXT').body;

    // decode quoted-printable S/MIME email html body
    const decodedBody = qp.decode(rawBody);

    // converted into readable html object
    const dom = new JSDOM(decodedBody);
    const links = [...dom.window.document.querySelectorAll('a')]
        .map(a => a.href)
        .filter(href => href && href.includes('mailchi.mp'));

    const mailchimpLink = links[0];

    if (!mailchimpLink) {
        await connection.end();
        console.log('No Mailchimp link found. Exiting...');
        return;
    }

    console.log('Mailchimp link found:', mailchimpLink);

    await connection.addFlags(latest.attributes.uid, '\\Seen');
    await connection.end();

    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.goto(mailchimpLink, { waitUntil: 'networkidle0' });

    const htmlContent = await page.content();
    fs.writeFileSync(ORIGINAL_HTML_FILE, htmlContent, 'utf-8');

    // apply sed command to html file
    fs.writeFileSync('sed_script.sed', config.generate.sed_options, 'utf-8');
    const sedCmd = `sed -f sed_script.sed ${ORIGINAL_HTML_FILE} > ${CLEANED_HTML_FILE}`;
    execSync(sedCmd, { shell: '/bin/bash' });

    // load the new html after the sed command is applied
    const fileUrl = 'file://' + path.resolve(CLEANED_HTML_FILE);
    await page.goto(fileUrl, { waitUntil: 'networkidle0' });

    // apply css styling
    await page.addStyleTag({
        content: config.generate.css_styling
      });

    await page.pdf({
        path: GENERAL_PDF_FILE,
        format: 'A4',
        margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' },
        printBackground: false
    });

    await browser.close();
    await trimPdfToMaxPages(GENERAL_PDF_FILE, GENERAL_PDF_FILE, config.generate.pdf_max_pages);
    console.log('general pdf successfully generated.');

    if (dryRun) {
        console.log('Dry run. Exiting...')
    } else {
        execSync(config.upload.cmd, { shell: '/bin/bash' });

        const mergerTasks = config.cover_letters || [];

        // add cover letters to the general pdf file
        for (const coverPath of mergerTasks) {
            const name = path.basename(coverPath, '.pdf');
            const outputFile = `infomail-${name}.pdf`;

            const merger = new PDFMerger();
            await merger.add(path.resolve(coverPath));
            await merger.add(path.resolve(GENERAL_PDF_FILE));

            await merger.save(outputFile);
            console.log(`pdf created: '${outputFile}'.`);

            await uploadToPingen(outputFile, config);
        }
    }
})();
