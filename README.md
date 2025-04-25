# Postlink
fully automate printing and sending an email as physical post

## Background
In our church we send each week a so-called ***infomail***, an email with current events, information and news. But circa a dozen older poeple can't access emails, so therefore we print a dozen *infomails*, and give them some people before each sunday service and some we send via the physical post.

This is quite tedious, so this project was made to automate the whole workflow. This equates to half an hour time saved each week.

## How does it work?
There is a seperate email address, where the *infomail* gets sent to. the postlink script periodically checks if a new email is in the inbox, and generates a pdf suitable for printing using custom rules.

The pdf then ist uploaded via a customizable command to a church computer, that uses it's own script to automatically print out the desired number of *infomails*.

Also, the pdf is customized with cover letters and uploaded to the (pingen.com api)[https://pingen.com], which is a service that prints the letters out and and sends them out via the physical post.

Now the only things we need to do is keep the server on which the postlink script runs running and ensuring the pingen.com account has enough credit.

## Installation
On a Unix-like server install
 - (and enable) a cronjob daemon like (cronie)[https://github.com/cronie-crond/cronie] [optional but recommended for periodic runs]
 - a recent version of [nodejs](https://nodejs.org/en/download)

Clone this repo and cd into it:
    git clone https://github.com/noahvogt/postlink.js
    cd postlink

Then, install the dependencies:
    npm install puppeteer imap-simple yaml jsdom quoted-printable pdf-merger-js pdf-lib axios

Apply your custom config in `config.yaml`. This example config serves enough of an explanation. If not, consult the source code.

```yaml
imap:
  user: whatever@example.org
  password: REDACTED
  host: mail.example.org
  port: 993
  tls: true
pingen:
  client_id: YOUR_CLIENT_ID
  client_secret: YOUR_CLIENT_SECRET
  organisation_id: YOUR_ORGANISATION_ID
upload:
  cmd: "rsync -uvP /home/postlink/infomail.pdf /var/www/dest/infomail.pdf"
cover_letters:
  - "cover_letters/noah-vogt.pdf"
  - "cover_letters/someone-else.pdf"
generate:
  pdf_max_pages: 5
  sed_options: |
    /title="Mailchimp Email Marketing"/d;
    /Besuchen Sie hier die Webversion/d;
  css_styling: |
    body {
        margin: 0 !important;
        padding: 0 !important;
        background: white !important;
        color: black !important;
        font-family: sans-serif;
        font-size: 12px !important;
        line-height: 1.15 !important;
    }

    h1, h2, h3, h4 {
      font-size: 13px !important;
      margin: 2px 0 !important;
    }

    p, li, td, th, div {
      font-size: 12px !important;
      margin: 1px 0 !important;
      padding: 0 !important;
    }

    img {
      max-width: 60% !important;
      height: auto !important;
      display: block;
      margin: 4px auto !important;
    }

    table {
      width: 100% !important;
      border-collapse: collapse;
    }
```

Run via
    node postlink.js

For periodic runs we recommend, as mentioned above, cronjobs.

For testing purposes, you can run with the option `--dry-run` to not upload the *infomail* the the curch computer and not send api requests to pingen.com.
    node postlink.js --dry-run

## Licensing

Postlink is a free (as in “free speech” and also as in “free beer”) Software. It is distributed under the GNU General Public License v3 (or any later version) - see the accompanying LICENSE file for more details.
