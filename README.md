# MV-MONT — Cloudflare Workers

Existujúci web beží cez Workers Static Assets, API cez Worker, dáta cez D1 a nahrané obrázky cez R2. Produkcia nepotrebuje Node HTTP server ani lokálne súbory na ukladanie dát. Node.js 22+ a pnpm sú potrebné iba na vývoj a deployment. Wrangler je pripnutý na 4.131.0 a lockfile je súčasťou projektu.

HTML, CSS, obsah, SEO súbory a obrázky sú v `public/`. URL `/kontakt.html`, `/sluzby/*.html`, `/index.html` ostávajú zachované. `html_handling: none` vypína automatické HTML redirecty; `/` sa interne obslúži ako `/index.html`. API používa rovnaký origin. Do assets sa posiela výhradne `public/`.

## Prvé nasadenie z čistého účtu

1. **MANUAL STEP:** Vytvorte Cloudflare účet, aktivujte Workers a R2 (R2 môže vyžadovať nastavenie fakturácie). Nainštalujte Node.js 22+ a pnpm 10.10.0. V koreňovom priečinku projektu:

   ```sh
   pnpm install
   npx wrangler login
   npx wrangler d1 create mvmont-db
   ```

2. **MANUAL STEP:** Do `wrangler.jsonc` vložte skutočné `d1_databases[0].database_id` z výstupu predchádzajúceho príkazu. Nulové UUID je iba lokálny placeholder. Ak máte viac účtov, doplňte aj správne `account_id` na najvyššej úrovni konfigurácie. Binding ponechajte `DB`.

3. Vytvorte bucket a aplikujte schému. Lokálna a vzdialená databáza sú oddelené:

   ```sh
   npx wrangler r2 bucket create mvmont-gallery
   npx wrangler d1 migrations apply DB --local
   npx wrangler d1 migrations apply DB --remote
   ```

4. **MANUAL STEP:** V `wrangler.jsonc` vyplňte `vars.CONTACT_TO` (firemná schránka), `vars.CONTACT_FROM` (adresa na doméne overenej v Resend, prípadne `MV-MONT <adresa@domena>`). `COMPANY_NAME` už obsahuje `MV-MONT`. Overenie odosielacej domény je opísané nižšie.

5. Nastavte secrets; príkazy si hodnoty vypýtajú interaktívne. Pre admin použite dlhý náhodný token z password managera. Nevkladajte ho do konfigurácie ani HTML:

   ```sh
   npx wrangler secret put ADMIN_TOKEN
   npx wrangler secret put RESEND_API_KEY
   ```

6. Lokálne overenie:

   ```sh
   pnpm check
   pnpm test
   pnpm build
   pnpm dev
   ```

   `pnpm build` je iba `wrangler deploy --dry-run`. V druhom termináli spustite `pnpm smoke`. Potom zastavte dev cez Ctrl+C.

7. Produkčné nasadenie:

   ```sh
   pnpm deploy
   ```

   Otvorte workers.dev URL z výstupu a vykonajte checklist nižšie. Repozitár neobsahuje skutočné Cloudflare ID, API kľúče ani automatické vytváranie vzdialených zdrojov.

Na Windows pri blokovaní PowerShell skriptov použite `pnpm.cmd` a `npx.cmd` namiesto `pnpm` a `npx`; netreba meniť execution policy.

## Resend — MANUAL STEP

Vytvorte účet na Resend. V **Domains → Add domain** pridajte doménu alebo subdoménu, z ktorej budete odosielať. Do jej DNS vložte presne záznamy zobrazené v Resend: DKIM TXT a SPF/MX pre odosielanie podľa konkrétneho nastavenia. Existujúce MX záznamy firemnej pošty nenahrádzajte záznamami pre inú subdoménu. Spustite overenie a počkajte na stav **Verified**. DMARC nastavte podľa vlastnej e-mailovej politiky. Podrobnosti: [overenie domény v Resend](https://resend.com/docs/dashboard/domains/introduction).

V **API Keys** vytvorte kľúč na odosielanie pre danú doménu a uložte ho cez `wrangler secret put RESEND_API_KEY`. `CONTACT_FROM` musí používať overenú doménu. `CONTACT_TO` musí byť skutočná firemná schránka; oba e-maily majú `reply_to` na túto adresu. Testovacia odosielacia doména Resend nie je náhradou za overenú doménu pre ľubovoľných zákazníkov.

Po nasadení odošlite kontaktný formulár so svojou adresou a skontrolujte firemnú schránku, zákaznícke potvrdenie, spam aj Resend Emails dashboard. Stav `sent` znamená prijatie požiadavky poskytovateľom, nie garantované doručenie do inboxu. Worker volá [Resend HTTP API](https://resend.com/docs/api-reference/emails/send-email), má 10-sekundový timeout pre každý e-mail a skúsi oboch príjemcov aj pri zlyhaní prvého.

## Lokálny vývoj

Skopírujte `.dev.vars.example` do `.dev.vars` a vyplňte vlastný lokálny `ADMIN_TOKEN`. V PowerShelli:

```powershell
Copy-Item .dev.vars.example .dev.vars
pnpm db:local
pnpm dev
```

Otvorte `http://127.0.0.1:8787/` a `/admin.html`. Token zadajte v admin paneli. Je uložený v localStorage ako predtým. Produkčné secrets sa pri lokálnom vývoji automaticky nepoužijú.

Bez `RESEND_API_KEY` formulár uloží kontakt a vráti HTTP 201 s `emailStatus: failed`. Na test reálnych e-mailov nastavte aj lokálne Resend a adresy v `.dev.vars`; taký test naozaj posiela e-maily. Lokálne D1/R2 dáta sú emulované vo Wrangler `.wrangler/state`, oddelene od produkcie. Nejde o filesystem používaný produkčným Workerom.

## API contract

| Endpoint | Metóda | Odpoveď |
| --- | --- | --- |
| `/api/contact` | POST | 201 `{ message, contact, emailStatus, emailDelivery, emailStatusRecorded }` |
| `/api/gallery` | GET | 200 `{ items: [...] }` |
| `/api/gallery` | POST + X-Admin-Token | 201 `{ item }` |
| `/api/gallery/:id` | PUT + X-Admin-Token | 200 `{ item }` |
| `/api/gallery/:id` | DELETE + X-Admin-Token | 200 `{ message }` |
| `/uploads/:key` | GET, HEAD | R2 obrázok s MIME typom, ETag a cache headers |

Kontakt vyžaduje stringy `name`, platný `email`, `phone`, `service`, `message`. Najprv sa vloží do D1 a až potom sa odosielajú e-maily. `emailStatus` je `sent`, `partial` alebo `failed`; samostatné výsledky obsahuje `emailDelivery`. Pri prerušení spracovania môže D1 obsahovať `pending`. Ak zlyhá iba aktualizácia stavu po odoslaní, odpoveď má `emailStatusRecorded: false`, ale kontakt ostáva uložený. Kontakty s `pending`, `partial`, `failed` priebežne kontrolujte v D1. Automatické opätovné odosielanie e-mailov nie je zavedené; formulár neposielajte opakovane len pre chýbajúce potvrdenie.

Gallery item obsahuje `id`, `title`, `description`, `category`, `imageUrl`, `createdAt`, `updatedAt`. `r2_key` je interný údaj. Kategórie: `frameless`, `framed`, `shutters`, `blinds`, `terraces`, `railings`, `screens`. POST potrebuje názov, kategóriu a obrázok. PUT umožňuje čiastočnú úpravu aj vymazanie popisu prázdnym stringom. Pri súbežnej úprave môže vrátiť 409; obnovte galériu.

Obrázok sa posiela ako `imageData` (base64 alebo data URL) + voliteľné `imageName`, prípadne `imageUrl` (HTTP/HTTPS). Podporované sú PNG, JPEG, WEBP, GIF; kontroluje sa signatúra aj deklarovaný MIME typ. Limit obrázka je **3 MiB**, celého JSON uploadu **4 MiB + 64 KiB**, kontaktu **64 KiB**. Názov súboru neurčuje cestu v R2. Metadata-only edit zachová aktuálnu `/uploads/...` URL; nové interné URL nemožno priradiť cudzej položke. Nové obrázky majú UUID key.

Nahradený R2 objekt sa maže až po úspešnom zápise D1. DELETE odstráni DB záznam a následne vlastný R2 objekt. D1 tabuľka `r2_cleanup` uchová zlyhané mazania; opakujú sa pri zmenách galérie a denne o 03:17 UTC. Rozpracované uploady majú hodinovú ochrannú lehotu. Cleanup nikdy nemaže objekt odkazovaný živým záznamom. R2 URL má cache 24 hodín, preto stará kópia môže po zmazaní dočasne zostať v prehliadači/cache.

API nepovoľuje wildcard CORS, odmieta cudzie Origin pre zápisy, používa parametrizované SQL a nevracia interné chyby. Neplatná metóda má 405, nesprávny token 401, nenastavený admin secret 503, chybný JSON/údaje 400, nadlimitný request 413 a nesprávny Content-Type 415. Security headers sa aplikujú na API aj assets.

## Dáta a prípadný import

Pri migrácii bolo overené: `data/gallery.json` obsahuje `[]`, `data/contacts.json` má 0 bajtov a `uploads/` iba `.gitkeep`. Nie sú produkčné dynamické dáta na import. Tieto prázdne podklady zostávajú zachované mimo `public/`. Všetky existujúce `img/*` sú v `public/img/`.

Importér je offline nástroj, nie runtime databáza. Nevytvára falošné záznamy, neprepisuje existujúci výstup, validuje údaje a escapuje SQL literály. Neplatné záznamy spôsobia chybu pred zápisom výstupu. Vyžaduje pôvodné ID a časové údaje, neodhaduje ich. Stav starých e-mailov je `unknown`. Príklad:

```sh
node scripts/import-json.mjs data import.sql
# Pri aktuálnych prázdnych dátach vznikne iba komentár; SQL netreba aplikovať.
# Pri skutočných dátach najprv skontrolujte celý import.sql:
npx wrangler d1 execute DB --local --file=import.sql
# Až po lokálnom overení a zálohe produkcie:
npx wrangler d1 execute DB --remote --file=import.sql
```

Ak import odkazuje na staré `/uploads/<key>`, najprv manuálne overte typ a obsah súborov a nahrajte ich pod rovnakým key do R2. Pre konkrétny PNG:

```sh
npx wrangler r2 object put mvmont-gallery/POVODNY-KEY.png --file=uploads/POVODNY-KEY.png --content-type=image/png --remote
```

Použite správny Content-Type pre JPEG/WEBP/GIF. Import hlási každý potrebný objekt. Nepúšťajte opakovane rovnaký import; duplicitné primárne kľúče majú skončiť chybou. SQL exporty obsahujú osobné údaje a nepatria do gitu ani `public/`.

## Vlastná doména — MANUAL STEP

Pridajte doménu do Cloudflare, skontrolujte importované DNS záznamy (vrátane pošty) a u registrátora nastavte pridelené nameservery. Po aktivácii zóny prejdite na **Workers & Pages → mvmont → Settings → Domains & Routes → Add → Custom Domain**. Pridajte používaný hostname aj `www` variant, ak sa používa. Cloudflare nastaví smerovanie a certifikát. Zachovajte hostname použitý v existujúcich canonical URL a sitemap; preveríte ho v `public/sitemap.xml` a HTML. Ak existuje konfliktný DNS záznam, vyriešte ho pri prechode po overení Worker URL.

Alternatívne vložte skutočné hostname do `routes` vo `wrangler.jsonc`, napríklad objekty `{ "pattern": "VASA-DOMENA", "custom_domain": true }`, a deploynite. Placeholder nepoužívajte ako reálny hostname. [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Testy po deployi

Read-only kontrola všetkých lokálnych statických súborov proti produkcii:

```sh
pnpm smoke https://VASA-DOMENA
```

Manuálny checklist:

- `/`, `/index.html`, `/kontakt.html`, všetky `/sluzby/*.html`, obrázky, robots, sitemap a Google verification vracajú 200 bez zmeny `.html` URL.
- Navigácia, cookie consent, kontakt a galéria vyzerajú ako pred migráciou; mobilné menu, filtre a lightbox fungujú.
- Formulár odmietne prázdne polia a chybný e-mail. Platný test uloží D1 kontakt a pošle oba e-maily.
- `/api/gallery` vráti `{ "items": [...] }`; prázdna galéria je platný stav.
- V `/admin.html` skúste nesprávny token, potom správny. Pridajte PNG/JPEG/WEBP/GIF, upravte názov aj popis, nahraďte obrázok, použite externú URL a položku vymažte. Skontrolujte zodpovedajúce D1 aj R2 zmeny.
- Neplatná kategória, chybný JSON, nesprávny typ a príliš veľký upload sa odmietnu. Pri odmietnutej výmene zostane pôvodný obrázok dostupný.
- `/data/contacts.json`, `/src/index.js`, `/.dev.vars`, `/.git/config` a `/node_modules/wrangler/package.json` vracajú 404.
- V lokálnom prostredí bez Resend kľúča overte uložený kontakt aj pri `emailStatus: failed`; neodpájajte kvôli testu produkčný kľúč.

Priame API overenie v PowerShelli (zmeny vytvárajú skutočné testovacie záznamy; kontakt odošle e-maily):

```powershell
$baseUrl = 'https://VASA-DOMENA'
$adminToken = Read-Host 'Admin token' -MaskInput # PowerShell 7; na Windows PowerShell použite admin UI
$headers = @{ 'X-Admin-Token' = $adminToken }
Invoke-RestMethod "$baseUrl/api/gallery"
$body = @{ title='API test'; category='framed'; imageUrl='https://VASA-DOMENA/img/RP9.jpg' } | ConvertTo-Json
$created = Invoke-RestMethod "$baseUrl/api/gallery" -Method Post -Headers $headers -ContentType 'application/json' -Body $body
$id = $created.item.id
Invoke-RestMethod "$baseUrl/api/gallery/$id" -Method Put -Headers $headers -ContentType 'application/json' -Body '{"title":"Updated","description":""}'
$imageBytes = [IO.File]::ReadAllBytes((Resolve-Path 'public/img/RP9.jpg'))
$upload = @{ imageData=[Convert]::ToBase64String($imageBytes); imageName='test.jpg' } | ConvertTo-Json
$updated = Invoke-RestMethod "$baseUrl/api/gallery/$id" -Method Put -Headers $headers -ContentType 'application/json' -Body $upload
Invoke-WebRequest "$baseUrl$($updated.item.imageUrl)" -Method Head
Invoke-RestMethod "$baseUrl/api/gallery/$id" -Method Delete -Headers $headers
$contact = @{ name='Test'; email='VASA-TESTOVACIA-ADRESA'; phone='123'; service='framed'; message='Test po nasadeni' } | ConvertTo-Json
Invoke-RestMethod "$baseUrl/api/contact" -Method Post -ContentType 'application/json' -Body $contact
Remove-Variable adminToken,headers
```

## Kontrola D1, R2 a logov

```sh
npx wrangler d1 execute DB --remote --command="SELECT id,created_at,email_status,company_email_status,customer_email_status FROM contacts ORDER BY created_at DESC LIMIT 20"
npx wrangler d1 execute DB --remote --command="SELECT * FROM gallery ORDER BY created_at DESC LIMIT 20"
npx wrangler d1 execute DB --remote --command="SELECT * FROM r2_cleanup"
npx wrangler tail
```

Pre lokálnu databázu nahraďte `--remote` za `--local`. Obsah správy a kontakt zobrazíte v Cloudflare **Storage & databases → D1 → mvmont-db → Console** cez SELECT podľa ID. Nezverejňujte výstupy s osobnými údajmi.

R2 objekty skontrolujte v **R2 Object Storage → mvmont-gallery → Objects**; bucket nechajte súkromný, verejné obrázky poskytuje Worker. Konkrétny objekt stiahnete cez `npx wrangler r2 object get mvmont-gallery/KEY --file=backups/image.png --remote` po vytvorení priečinka `backups`. Lokálny cron možno manuálne vyvolať GET na `http://127.0.0.1:8787/cdn-cgi/local/scheduled`.

## Záloha a rollback

Pred ďalšími zmenami produkčnej databázy vytvorte priečinok `backups` a export:

```sh
npx wrangler d1 export DB --remote --output=backups/before-change.sql
npx wrangler deployments list
npx wrangler versions list
```

Pri chybe v kóde vráťte konkrétnu známu funkčnú verziu: `npx wrangler rollback VERSION_ID`. Na prvom deployi ešte nie je predchádzajúca verzia; opravte a opäť deploynite. Rollback Workera automaticky nevracia D1 schému, dáta ani odstránené R2 objekty. Migrujte schému spätne kompatibilne a R2 zálohujte podľa vlastnej retenčnej politiky.

Pre poškodenú D1 databázu použite dostupný Time Travel bookmark alebo čas cez `npx wrangler d1 time-travel info DB --timestamp="ISO-UTC-CAS"`, potom po posúdení straty novších zápisov `npx wrangler d1 time-travel restore DB --bookmark="BOOKMARK"`. Obnova dát je manuálna prevádzková operácia. Alternatívne obnovte export do novej D1 databázy, otestujte ho a prepnite binding. [D1 zálohy a Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [Worker rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## Overenie implementácie

`pnpm check` overuje syntax a izoláciu assets, `pnpm test` používa skutočný lokálny Workers/D1/R2 runtime cez Miniflare dodaný s pripnutým Wranglerom. Resend odpovede sú v testoch mockované. `pnpm smoke` overuje routing bežiaceho Workera. Produkčné doručovanie e-mailov, účet, DNS a doménu možno overiť až po manuálnych krokoch vyššie.

Node filesystem importy sú iba v offline skriptoch/testoch. Pôvodný server, lokálna JSON databázová implementácia a e-mail transport boli odstránené. Vývojové `template_config.json` zostáva mimo deployovaných assets. Konfigurácia statických URL vychádza z [Workers HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/).
