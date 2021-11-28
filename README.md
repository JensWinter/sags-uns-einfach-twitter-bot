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
3. .env-Datei erstellen
```
cp ./.env-template ./.env
```
4. Umgebungsvariablen festlegen
   (Datei .env editieren und die jeweiligen [Parameter](##parameter) festlegen)
5. Ausführen
```
node ./start.js
```

bzw. einen **Cron-Job** einrichten, der die Ausführung regelmäßig (bswp. stündlich) startet.

## Parameter

### BASE_URL
Gibt die Adresse der Sag's-uns-einfach-Instanz an. Jede Kommune, die teilnimmt, hat eine eigene Adresse.
Beispiel für Magdeburg: `https://include-st.zfinder.de/mobileportalpms/286585400`

Die folgenden Kommunen nehmen derzeit (Stand Nov. 2021) teil:
Name | Url
-----|-----
Stadt Gifhorn | https://include-ni.zfinder.de/mobileportalpms/314181900
Stadt Goslar | https://include-ni.zfinder.de/mobileportalpms/307091000
Stadt Halle (Saale) | https://include-st.zfinder.de/mobileportalpms/266802600
Landeshauptstadt Magdeburg | https://include-st.zfinder.de/mobileportalpms/286585400
Gemeinde Schkopau | https://include-st.zfinder.de/mobileportalpms/288025400
Stadt Mücheln | https://include-st.zfinder.de/mobileportalpms/317057000
Stadt Wolmirstedt | https://include-st.zfinder.de/mobileportalpms/309794300
Stadt Genthin | https://include-st.zfinder.de/mobileportalpms/268421200
Stadt Bad Soden im Taunus | https://include-he.zfinder.de/mobileportalpms/348111492
Stadt Celle | https://include-ni.zfinder.de/mobileportalpms/320331702
Samtgemeinde Bardowick | https://include-ni.zfinder.de/mobileportalpms/320331706
Einheitsgemeinde Walsrode | https://include-ni.zfinder.de/mobileportalpms/320331707
Landkreis Heidekreis | https://include-ni.zfinder.de/mobileportalpms/319680800
Einheitsgemeinde Gommern | https://include-st.zfinder.de/mobileportalpms/333316582
Stadt Springe | https://include-ni.zfinder.de/mobileportalpms/320331710
Stadt Wettin-Löbejün | https://include-st.zfinder.de/mobileportalpms/332773732
Stadt Calbe (Saale) | https://include-st.zfinder.de/mobileportalpms/334569130
Stadt Wernigerode | https://include-st.zfinder.de/mobileportalpms/332342630
Stadt Coswig (Anhalt) | https://include-st.zfinder.de/mobileportalpms/333046511/
Stadt Hecklingen | https://include-st.zfinder.de/mobileportalpms/339280444
Stadt Tangerhütte | https://include-st.zfinder.de/mobileportalpms/337219045
Stadt Laatzen | https://include-ni.zfinder.de/mobileportalpms/320598524
Verbandsgemeinde Beetzendorf-Diesdorf | https://include-st.zfinder.de/mobileportalpms/340246041
Stadt Haldensleben | https://include-st.zfinder.de/mobileportalpms/347927245/
Stadt Schönebeck | https://include-st.zfinder.de/mobileportalpms/341255014
Stadt Bassum | https://include-ni.zfinder.de/mobileportalpms/329182136
Stadt Uelzen | https://include-ni.zfinder.de/mobileportalpms/334820982/
Stadt Syke | https://include-ni.zfinder.de/mobileportalpms/332144900
Gemeinde Adendorf | https://include-ni.zfinder.de/mobileportalpms/336819411
Stadt Munster | https://include-ni.zfinder.de/mobileportalpms/322702653/
Gemeinde Barleben | https://include-st.zfinder.de/mobileportalpms/343337872/
Samtgemeinde Dahlenburg | https://include-ni.zfinder.de/mobileportalpms/341201998/
Stadt Limburg a.d.Lahn | http://include-he.zfinder.de/mobileportalpms/351779008/
Gemeinde Muldestausee | https://include-st.zfinder.de/mobileportalpms/343472229/
Stadt Zeitz | http://include-st.zfinder.de/mobileportalpms/345073887/
Stadt Oschersleben (Bode) | https://include-st.zfinder.de/mobileportalpms/346555433/
Stadt Halberstadt | https://include-st.zfinder.de/mobileportalpms/347074045/
Verbandsgemeinde Westliche Börde | https://include-st.zfinder.de/mobileportalpms/357015643/
Einheitsgemeinde Biederitz | https://include-st.zfinder.de/mobileportalpms/371367221/
Stadt Oranienbaum-Wörlitz | https://include-st.zfinder.de/mobileportalpms/359805508/
Stadt Lüneburg | https://include-ni.zfinder.de/mobileportalpms/340312162/
Stadt Zerbst/Anhalt | https://include-st.zfinder.de/mobileportalpms/363527099/
Stadt Bitterfeld-Wolfen | https://include-st.zfinder.de/mobileportalpms/364026281/
Samtgemeinde Bevensen-Ebstorf | https://include-ni.zfinder.de/mobileportalpms/372165719/
Stadt Nordenham | https://include-ni.zfinder.de/mobileportalpms/375368222/
Gemeinde Kriftel | https://include-he.zfinder.de/mobileportalpms/357398280/
Stadt Landsberg | https://include-st.zfinder.de/mobileportalpms/370258077/
Gemeinde Freigericht | https://include-he.zfinder.de/mobileportalpms/358205940/
Samtgemeinde Suderburg | https://include-ni.zfinder.de/mobileportalpms/377293617/
Samtgemeinde Ilmenau | https://include-ni.zfinder.de/mobileportalpms/379930241/
Stadt Nauheim | https://include-he.zfinder.de/mobileportalpms/357687425/
Samtgemeinde Gartow | https://include-ni.zfinder.de/mobileportalpms/384699736/
Samtgemeinde Ostheide | https://include-ni.zfinder.de/mobileportalpms/384235328/
Samtgemeinde Schwarmstedt | https://include-ni.zfinder.de/mobileportalpms/387477806/
Lutherstadt Wittenberg | https://include-st.zfinder.de/mobileportalpms/382592859/
Stadt Bad Schmiedeberg | https://include-st.zfinder.de/mobileportalpms/384327086/
Hansestadt Salzwedel | https://include-st.zfinder.de/mobileportalpms/383005984/
Gemeinde Lemwerder | https://include-ni.zfinder.de/mobileportalpms/409206934/
Stadt Annaburg | https://include-st.zfinder.de/mobileportalpms/387092504/
Hansestadt Buxtehude | https://include-ni.zfinder.de/mobileportalpms/398735820/
Stadt Bleckede | https://include-ni.zfinder.de/mobileportalpms/404396155/
Stadt Oberharz am Broken | https://include-st.zfinder.de/mobileportalpms/388351656/
Samtgemeinde Amelinghausen | https://include-ni.zfinder.de/mobileportalpms/399954033/
Gemeinde Stadland | https://include-ni.zfinder.de/mobileportalpms/402634668/
Gemeinde Garrel | https://include-ni.zfinder.de/mobileportalpms/423602917/
Gemeinde Weyhe | https://include-ni.zfinder.de/mobileportalpms/420890532/
Hansestadt Osterburg (Altmark) | https://include-st.zfinder.de/mobileportalpms/391500186/
Verbandsgemeinde Arneburg-Goldbeck | https://include-st.zfinder.de/mobileportalpms/389991183/
Gemeinde Wardenburg | https://include-ni.zfinder.de/mobileportalpms/435533408/
Stadt Grünberg | https://include-he.zfinder.de/mobileportalpms/374537072/
Gemeinde Huy | https://include-st.zfinder.de/mobileportalpms/393598852/


### LIMIT_MESSAGES_SYNC
Anzahl der Meldungen, die pro Durchlauf geholt werden soll.

### TWEET_DELAY_SECONDS
Zeit, die zwischen einzelnen Tweets mindestens vergehen soll.

### MAX_TWEETS_PER_RUN
Maximale Anzahl von Tweets, die pro Durchlauf höchstens entstehen sollen. Sollten mehr Meldungen verfügbar sein, so werden nur Tweets für die neuesten Meldungen erzeugt.

### TWITTER_API_KEY
Bitte dem Twitter Developer Portal für den jeweiligen Twitter-Account entnehmen.

### TWITTER_API_SECRET
Bitte dem Twitter Developer Portal für den jeweiligen Twitter-Account entnehmen.

### TWITTER_ACCESS_TOKEN
Bitte dem Twitter Developer Portal für den jeweiligen Twitter-Account entnehmen.

### TWITTER_ACCESS_TOKEN_SECRET
Bitte dem Twitter Developer Portal für den jeweiligen Twitter-Account entnehmen.

### DO_THE_TWEETS
Muss auf `true` gesetzt werden, damit Tweets erzeugt werden. Mit diesem Flag ist es möglich, das Erzeugen von Tweets zu deaktivieren.

### LOG_TO_SLACK_CHANNEL
Auf `true` setzen, damit Fehler-Benachrichtung und andere Benachrichtigungen in einen Slack-Kanal gepostet werden. Setzt voraus, dass der Parameter [SLACK_WEBHOOK_URL](###slack-webhook-url) korrekt gesetzt ist.

### SLACK_WEBHOOK_URL
Webhook-Adresse zum Posten von Benachrichtigungen in einen bestimmten Slack-Kanal.
