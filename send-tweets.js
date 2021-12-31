'use strict';

const https = require('https');
const fs = require('fs');
const winston = require('winston');
const TwitterClient = require('twitter-api-client').TwitterClient;


require('dotenv').config();


const proj4 = initProj4();
const config = initArgs();

const tenantName = config.tenantName;
const tenantId = config.tenantId;
const baseUrl = config.baseUrl;
const tenantBaseUrl = `${baseUrl}/mobileportalpms/${config.tenantId}`;

const tenantsDir = './tenants';
const tenantDir = `${tenantsDir}/${tenantId}`;
const imagesDir = `${tenantDir}/images`;
const queueNewMessagesDir = `${tenantDir}/queue_new_messages`;
const queueResponseUpdatesDir = `${tenantDir}/queue_response_updates`;
const queueStatusUpdatesDir = `${tenantDir}/queue_status_updates`;

const logger = initLogger();
const twitterClient = initTwitterClient();

const TWEET_WITH_IMAGE = config.tweetWithImage;
const LOG_TO_SLACK_CHANNEL = config.logToSlackChannel;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;


popAndProcessMessage()
    .then()
    .catch(e => logger.error('Processing queue failed.', e));


function initProj4() {
    const proj4 = require('proj4');
    proj4.defs([
        ['EPSG:4326', '+title=WGS 84 (long/lat) +proj=longlat +ellps=WGS84 +datum=WGS84 +units=degrees'],
        ['EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs ']
    ]);
    return proj4;
}


function initArgs() {

    const yargs = require('yargs/yargs');
    const { hideBin } = require('yargs/helpers');
    const argv = yargs(hideBin(process.argv))
        .options({
            'h': {
                alias: 'help'
            },
            'c': {
                alias: 'config',
                demandOption: true,
                type: 'string',
            }
        })
        .coerce('config', arg => JSON.parse(fs.readFileSync(arg, 'utf8')))
        .version()
        .argv;

    return argv.config;

}


function initLogger() {

    return winston.createLogger({
        level: 'info',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
        ),
        transports: [
            new winston.transports.File({ filename: `${tenantDir}/output-send-tweets.log` }),
            new winston.transports.Console({ format: winston.format.simple() })
        ]
    });

}


function initTwitterClient() {
    return new TwitterClient({
        apiKey: process.env.TWITTER_API_KEY,
        apiSecret: process.env.TWITTER_API_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET
    });
}


async function popAndProcessMessage() {

    const itemToProcess = fs
        .readdirSync(queueNewMessagesDir)
        .filter(f => f.startsWith('message-') && f.endsWith('.json'))
        .sort()
        .shift();

    if (itemToProcess) {

        logger.info(`Found new message to tweet: ${itemToProcess}`);

        const message = loadMessage(itemToProcess);

        const imageData = message.messageImage ? loadImage(message) : null;

        await processMessage(message, imageData);

        removeItemFromQueue(itemToProcess);

    }

}


function loadMessage(filename) {
    return JSON.parse(fs.readFileSync(`${queueNewMessagesDir}/${filename}`, 'utf-8'));
}


function loadImage(messageDetails) {
    logger.info(`Loading image of message "${messageDetails.id}"`);
    const mimeType = messageDetails.messageImage.mimeType;
    const fileExtension = mimeType === 'image/jpeg' ? '.jpeg' : (mimeType === 'image/png' ? '.png' : '');
    const filename = `${imagesDir}/${messageDetails.id}-${messageDetails.messageImage.id}${fileExtension}`;
    return fs.readFileSync(filename);
}


async function processMessage(message, imageData) {

    const localeOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
    const date = new Date(message.createdDate).toLocaleDateString('de-DE', localeOptions);
    const subject = message.subject.slice(0, TWEET_WITH_IMAGE && imageData ? 224 : 234);
    const url = `${tenantBaseUrl}#meldungDetail?id=${message.id}`;

    let status = `${date}:

${subject}
${url}`;

    const coordinateSystem = message.messagePosition?.geoCoding?.coordinateSystem;
    const display_coordinates = coordinateSystem === 'EPSG:25832' || coordinateSystem === 'EPSG:4326';
    let lat = null;
    let long = null;
    if (display_coordinates) {
        const coord = [message.messagePosition.geoCoding.longitude, message.messagePosition.geoCoding.latitude];
        if (coordinateSystem === 'EPSG:25832') {
            const destinationCoord = proj4('EPSG:25832', 'EPSG:4326', coord);
            lat = destinationCoord[1];
            long = destinationCoord[0];
        } else {
            lat = message.messagePosition.geoCoding.latitude;
            long = message.messagePosition.geoCoding.longitude;
        }
    }

    if (TWEET_WITH_IMAGE && imageData) {

        let mediaId = null;
        try {
            mediaId = await uploadImage(imageData);
        } catch (e) {
            return logFailedTweet(e);
        }

        status += `
Bild: LH Magdeburg`;

        try {
            await sendTweet(status, display_coordinates, lat, long, mediaId);
        } catch(e) {
            return logFailedTweet(e);
        }

    } else {
        try {
            await sendTweet(status, display_coordinates, lat, long, null);
        } catch(e) {
            return logFailedTweet(e);
        }
    }

}


async function uploadImage(imageDataBuffer) {

    logger.info('Uploading image to Twitter')

    return new Promise((resolve, reject) => {

        // noinspection JSCheckFunctionSignatures
        const base64 = imageDataBuffer.toString('base64');
        const uploadParams = { media_data: base64 };
        twitterClient.media
            .mediaUpload(uploadParams)
            .then(uploadResult => {
                logger.info('Image successfully sent to Twitter')
                resolve(uploadResult.media_id_string);
            })
            .catch(reject);

    });

}


function sendTweet(status, display_coordinates, lat, long, mediaId) {
    logger.info('Sending tweet...');
    logger.info(`...with status "${status}"`)
    if (mediaId) {
        logger.info(`...with media "${mediaId}"`)
    }
    if (display_coordinates) {
        logger.info(`...with coordinate lat="${lat}" long="${long}"`);
    }
    const parameters = display_coordinates
        ? { status, display_coordinates, lat, long, media_ids: mediaId }
        : { status, media_ids: mediaId };
    return twitterClient.tweets.statusesUpdate(parameters);
}


function removeItemFromQueue(filename) {
    logger.info(`Removing item "${filename}" from new messages queue`)
    fs.unlinkSync(`${queueNewMessagesDir}/${filename}`)
}


function logFailedTweet(error) {
    const text = `Sending tweet failed: ${JSON.stringify(error.data)}`;
    logger.error(text)
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function sendToSlackChannel(message) {

    const text = `${tenantName}/${tenantId}: ${message}`;
    const strData = JSON.stringify({ text });
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': strData.length
        }
    };
    const req = https.request(
        SLACK_WEBHOOK_URL,
        options,
        res => {
            if (res.statusCode !== 200) {
                logger.error(`Failed to send message to Slack channel: ${text}`)
            }
        }
    );

    req.on('error', error => console.error(error));
    req.write(strData);
    req.end();

}


