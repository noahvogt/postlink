# Postlink
fully automate printing and sending an email as physical post

## Background
In our local community organization we send each week a so-called ***infomail***, an email with current events, information and news. But circa a dozen older people can't access emails, so therefore we print a dozen *infomails*, and hand some of them out in person at our weekly gathering and send the rest via the physical post.

This is quite tedious, so this project was made to automate the whole workflow. This equates to half an hour time saved each week.

## How does it work?
There is a separate email address, where the *infomail* gets sent to. The postlink script periodically checks if a new email is in the inbox, and generates a pdf suitable for printing using custom rules.

The pdf then is uploaded via a customizable command to an on-site computer, that uses its own script to automatically print out the desired number of *infomails*.

Also, the pdf is customized with cover letters and uploaded to the [pingen.com api](https://pingen.com), which is a service that prints the letters out and sends them out via the physical post.

Now the only things we need to do is keep the server on which the postlink script runs running and ensuring the pingen.com account has enough credit.

## Installation
On a Unix-like server install
 - (and enable) a cronjob daemon like [cronie](https://github.com/cronie-crond/cronie) [optional but recommended for periodic runs]
 - a recent version of [nodejs](https://nodejs.org/en/download)

Clone this repo and cd into it:

    git clone https://github.com/noahvogt/postlink
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

For periodic runs we recommend, as mentioned above, cronjobs. For example, to run the script every 10 minutes I use:

    */10 * * * * cd /home/postlink/postlink && { flock -n -o /tmp/postlink.lock timeout -k 30s 9m /home/postlink/.nvm/versions/node/v22.15.0/bin/node postlink.js; echo "postlink exit code: $?"; } 2>&1 | logger -t postlink

The wrapper commands guard against runs that hang, e.g. on a stalled IMAP connection, which would otherwise pile up and eat memory:
 - `flock -n -o /tmp/postlink.lock` only allows one run at a time; a new run exits immediately while the previous one still holds the lock. `-o` keeps child processes like the puppeteer browser from holding on to the lock.
 - `timeout -k 30s 9m` stops a run after 9 minutes (before the next cron run), and kills it 30 seconds later if it does not exit. The limit is generous on purpose: the email gets marked as read before the pdf is generated and uploaded, so a run that is cut off at that stage would skip that *infomail*.
 - `{ ...; echo "postlink exit code: $?"; } 2>&1 | logger -t postlink` sends both output and errors to the system log, and logs the exit code of the script itself (`124` on a timeout) instead of the one of `logger`. Read the log with `journalctl -t postlink`.

For testing purposes, you can run with the option `--dry-run` to not upload the *infomail* to the on-site computer and not send api requests to pingen.com.

    node postlink.js --dry-run

## Licensing

Postlink is a free (as in “free speech” and also as in “free beer”) Software. It is distributed under the GNU General Public License v3 (or any later version) - see the accompanying LICENSE file for more details.
