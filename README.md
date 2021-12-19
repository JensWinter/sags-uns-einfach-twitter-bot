# Sag's-uns-einfach Twitter-Bot

Dieser Twitter-Bot basiert auf Meldungen, die über die Plattform [Sag's uns einfach](https://sagsunseinfach.de/) veröffentlicht werden. Dabei handelt es sich nach den Angaben der Macher*innen um ein sogenannten ["Ideen- und Beschwerdemanagement"](https://sagsunseinfach.de/ueber-sags-uns-einfach/). Dieses System ist mittlerweile in vielen deutschen Kommunen im Einsatz. 

Der Twitter-Bot veröffentlicht Tweets mit Angaben zu jeweils einem neuen Eintrag auf der Sag's-uns-einfach-Plattform, nachdem dieser dort verfügbar wird.

## Voraussetzungen

- Node.js
- Slack-Kanal mit Webhook-Integration (optional)

## Setup

1. Projekt clonen und in das Verzeichnis wechseln
```
git clone https://github.com/JensWinter/sags-uns-einfach-twitter-bot.git
cd sags-uns-einfach-twitter-bot
```
2. Abhängigkeiten installieren
```
npm ci
```
3. config-Datei erstellen
```
cp ./.config.template.json ./config.json
```
4. Konfiguration festlegen
   (Datei config.json editieren und die jeweiligen [Parameter](#parameter) festlegen)
5. Ausführen
```
node ./start.js -c config.json
```

bzw. einen **Cron-Job** einrichten, der die Ausführung regelmäßig (bspw. stündlich) startet.

## Konfigurationsparameter

### tenantName


### tenantId
Die Id der Kommune, wie in der Sag's-uns-einfach-Instanz festgelegt.
Beispiel für Magdeburg: `286585400`

Die folgenden Kommunen nehmen derzeit (Quelle: [https://sagsunseinfach.de](https://sagsunseinfach.de), Stand Nov. 2021) teil:
Name | Id | Url
-----|-----|-----
Stadt Gifhorn | 314181900 | https://include-ni.zfinder.de/mobileportalpms/314181900
Stadt Goslar | 307091000 | https://include-ni.zfinder.de/mobileportalpms/307091000
Stadt Halle (Saale) | 266802600 | https://include-st.zfinder.de/mobileportalpms/266802600
Landeshauptstadt Magdeburg | 286585400 | https://include-st.zfinder.de/mobileportalpms/286585400
Gemeinde Schkopau | 288025400 | https://include-st.zfinder.de/mobileportalpms/288025400
Stadt Mücheln | 317057000 | https://include-st.zfinder.de/mobileportalpms/317057000
Stadt Wolmirstedt | 309794300 | https://include-st.zfinder.de/mobileportalpms/309794300
Stadt Genthin | 268421200 | https://include-st.zfinder.de/mobileportalpms/268421200
Stadt Bad Soden im Taunus | 348111492 | https://include-he.zfinder.de/mobileportalpms/348111492
Stadt Celle | 320331702 | https://include-ni.zfinder.de/mobileportalpms/320331702
Samtgemeinde Bardowick | 320331706 | https://include-ni.zfinder.de/mobileportalpms/320331706
Einheitsgemeinde Walsrode | 320331707 | https://include-ni.zfinder.de/mobileportalpms/320331707
Landkreis Heidekreis | 319680800 | https://include-ni.zfinder.de/mobileportalpms/319680800
Einheitsgemeinde Gommern | 333316582 | https://include-st.zfinder.de/mobileportalpms/333316582
Stadt Springe | 320331710 | https://include-ni.zfinder.de/mobileportalpms/320331710
Stadt Wettin-Löbejün | 332773732 | https://include-st.zfinder.de/mobileportalpms/332773732
Stadt Calbe (Saale) | 334569130 | https://include-st.zfinder.de/mobileportalpms/334569130
Stadt Wernigerode | 332342630 | https://include-st.zfinder.de/mobileportalpms/332342630
Stadt Coswig (Anhalt) | 333046511 | https://include-st.zfinder.de/mobileportalpms/333046511/
Stadt Hecklingen | 339280444 | https://include-st.zfinder.de/mobileportalpms/339280444
Stadt Tangerhütte | 337219045 | https://include-st.zfinder.de/mobileportalpms/337219045
Stadt Laatzen | 320598524 | https://include-ni.zfinder.de/mobileportalpms/320598524
Verbandsgemeinde Beetzendorf-Diesdorf | 340246041 | https://include-st.zfinder.de/mobileportalpms/340246041
Stadt Haldensleben | 347927245 | https://include-st.zfinder.de/mobileportalpms/347927245/
Stadt Schönebeck | 341255014 | https://include-st.zfinder.de/mobileportalpms/341255014
Stadt Bassum | 329182136 | https://include-ni.zfinder.de/mobileportalpms/329182136
Stadt Uelzen | 334820982 | https://include-ni.zfinder.de/mobileportalpms/334820982/
Stadt Syke | 332144900 | https://include-ni.zfinder.de/mobileportalpms/332144900
Gemeinde Adendorf | 336819411 | https://include-ni.zfinder.de/mobileportalpms/336819411
Stadt Munster | 322702653 | https://include-ni.zfinder.de/mobileportalpms/322702653/
Gemeinde Barleben | 343337872 | https://include-st.zfinder.de/mobileportalpms/343337872/
Samtgemeinde Dahlenburg | 341201998 | https://include-ni.zfinder.de/mobileportalpms/341201998/
Stadt Limburg a.d.Lahn | 351779008 | http://include-he.zfinder.de/mobileportalpms/351779008/
Gemeinde Muldestausee | 343472229 | https://include-st.zfinder.de/mobileportalpms/343472229/
Stadt Zeitz | 345073887 | http://include-st.zfinder.de/mobileportalpms/345073887/
Stadt Oschersleben (Bode) | 346555433 | https://include-st.zfinder.de/mobileportalpms/346555433/
Stadt Halberstadt | 347074045 | https://include-st.zfinder.de/mobileportalpms/347074045/
Verbandsgemeinde Westliche Börde | 357015643 | https://include-st.zfinder.de/mobileportalpms/357015643/
Einheitsgemeinde Biederitz | 371367221 | https://include-st.zfinder.de/mobileportalpms/371367221/
Stadt Oranienbaum-Wörlitz | 359805508 | https://include-st.zfinder.de/mobileportalpms/359805508/
Stadt Lüneburg | 340312162 | https://include-ni.zfinder.de/mobileportalpms/340312162/
Stadt Zerbst/Anhalt | 363527099 | https://include-st.zfinder.de/mobileportalpms/363527099/
Stadt Bitterfeld-Wolfen | 364026281 | https://include-st.zfinder.de/mobileportalpms/364026281/
Samtgemeinde Bevensen-Ebstorf | 372165719 | https://include-ni.zfinder.de/mobileportalpms/372165719/
Stadt Nordenham | 375368222 | https://include-ni.zfinder.de/mobileportalpms/375368222/
Gemeinde Kriftel | 357398280 | https://include-he.zfinder.de/mobileportalpms/357398280/
Stadt Landsberg | 370258077 | https://include-st.zfinder.de/mobileportalpms/370258077/
Gemeinde Freigericht | 358205940 | https://include-he.zfinder.de/mobileportalpms/358205940/
Samtgemeinde Suderburg | 377293617 | https://include-ni.zfinder.de/mobileportalpms/377293617/
Samtgemeinde Ilmenau | 379930241 | https://include-ni.zfinder.de/mobileportalpms/379930241/
Stadt Nauheim | 357687425 | https://include-he.zfinder.de/mobileportalpms/357687425/
Samtgemeinde Gartow | 384699736 | https://include-ni.zfinder.de/mobileportalpms/384699736/
Samtgemeinde Ostheide | 384235328 | https://include-ni.zfinder.de/mobileportalpms/384235328/
Samtgemeinde Schwarmstedt | 387477806 | https://include-ni.zfinder.de/mobileportalpms/387477806/
Lutherstadt Wittenberg | 382592859 | https://include-st.zfinder.de/mobileportalpms/382592859/
Stadt Bad Schmiedeberg | 384327086 | https://include-st.zfinder.de/mobileportalpms/384327086/
Hansestadt Salzwedel | 383005984 | https://include-st.zfinder.de/mobileportalpms/383005984/
Gemeinde Lemwerder | 409206934 | https://include-ni.zfinder.de/mobileportalpms/409206934/
Stadt Annaburg | 387092504 | https://include-st.zfinder.de/mobileportalpms/387092504/
Hansestadt Buxtehude | 398735820 | https://include-ni.zfinder.de/mobileportalpms/398735820/
Stadt Bleckede | 404396155 | https://include-ni.zfinder.de/mobileportalpms/404396155/
Stadt Oberharz am Broken | 388351656 | https://include-st.zfinder.de/mobileportalpms/388351656/
Samtgemeinde Amelinghausen | 399954033 | https://include-ni.zfinder.de/mobileportalpms/399954033/
Gemeinde Stadland | 402634668 | https://include-ni.zfinder.de/mobileportalpms/402634668/
Gemeinde Garrel | 423602917 | https://include-ni.zfinder.de/mobileportalpms/423602917/
Gemeinde Weyhe | 420890532 | https://include-ni.zfinder.de/mobileportalpms/420890532/
Hansestadt Osterburg (Altmark) | 391500186 | https://include-st.zfinder.de/mobileportalpms/391500186/
Verbandsgemeinde Arneburg-Goldbeck | 389991183 | https://include-st.zfinder.de/mobileportalpms/389991183/
Gemeinde Wardenburg | 435533408 | https://include-ni.zfinder.de/mobileportalpms/435533408/
Stadt Grünberg | 374537072 | https://include-he.zfinder.de/mobileportalpms/374537072/
Gemeinde Huy | 393598852 | https://include-st.zfinder.de/mobileportalpms/393598852/

### baseUrl
Kann für jede teilnehmende Kommune der Liste oben entnommen werden: 
- Sachsen-Anhalt: `https://include-st.zfinder.de`
- Niedersachsen: `https://include-ni.zfinder.de`
- Hessen: `https://include-he.zfinder.de`

### limitMessagesSync
Anzahl der Meldungen, die pro Durchlauf geholt werden soll.

### tweetDelaySeconds
Zeit, die zwischen einzelnen Tweets mindestens vergehen soll.

### maxTweetsPerRun
Maximale Anzahl von Tweets, die pro Durchlauf höchstens entstehen sollen. Sollten mehr Meldungen verfügbar sein, so werden nur Tweets für die neuesten Meldungen erzeugt.

### twitter.apiKey
Bitte dem Twitter Developer Portal für den jeweiligen Twitter-Account entnehmen.

### twitter.apiSecret
Bitte dem Twitter Developer Portal für den jeweiligen Twitter-Account entnehmen.

### twitter.accesstoken
Bitte dem Twitter Developer Portal für den jeweiligen Twitter-Account entnehmen.

### twitter.accessTokenSecret
Bitte dem Twitter Developer Portal für den jeweiligen Twitter-Account entnehmen.

### tweetWithImage
Wenn dieser Wert auf `true` gesetzt ist, wird - sofern vorhanden - das zur Meldung gehörende Bild im Tweet eingebettet.

### logToSlackChannel
Auf `true` setzen, damit Fehler-Benachrichtung und andere Benachrichtigungen in einen Slack-Kanal gepostet werden. Setzt voraus, dass der Parameter [SLACK_WEBHOOK_URL](###slack-webhook-url) korrekt gesetzt ist.

### slackWebhookUrl
Webhook-Adresse zum Posten von Benachrichtigungen in einen bestimmten Slack-Kanal.
