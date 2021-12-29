'use strict';

const https = require('https');
const fs = require('fs');
const TwitterClient = require('twitter-api-client').TwitterClient;
const winston = require('winston');

require('dotenv').config();


const proj4 = initProj4();
const config = initArgs();

const tenantName = config.tenantName;
const tenantId = config.tenantId;
const baseUrl = config.baseUrl;
const tenantBaseUrl = `${baseUrl}/mobileportalpms/${config.tenantId}`;

const tenantsDir = './tenants';
const tenantDir = `${tenantsDir}/${tenantId}`;
const messagesDir = `${tenantDir}/messages`;
const allMessagesFilename = `${messagesDir}/all-messages.json`;
const imagesDir = `${tenantDir}/images`;

const logger = initLogger();
const twitterClient = initTwitterClient();

const DATETIME_PREFIX = createDateTimePrefix();
const LIMIT_MESSAGES_SYNC = config.limitMessagesSync;
const TWEET_DELAY_SECONDS = config.tweetDelaySeconds;
const MAX_TWEETS_PER_RUN = config.maxTweetsPerRun;
const TWEET_WITH_IMAGE = config.tweetWithImage;
const LOG_TO_SLACK_CHANNEL = config.logToSlackChannel;

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;


logger.info('Run initiated.')


prepareTenantDirectory();


checkAndProcessNewMessages();


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
            new winston.transports.File({ filename: `${tenantDir}/output.log` }),
            new winston.transports.Console({ format: winston.format.simple() })
        ]
    });

}


function createDateTimePrefix() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = `${now.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${now.getUTCDate()}`.padStart(2, '0');
    const hour = `${now.getUTCHours()}`.padStart(2, '0');
    const minutes = `${now.getUTCMinutes()}`.padStart(2, '0');
    const seconds = `${now.getUTCSeconds()}`.padStart(2, '0');
    return `${year}-${month}-${day}T${hour}-${minutes}-${seconds}Z`;
}


function initTwitterClient() {
    return new TwitterClient({
        apiKey: process.env.TWITTER_API_KEY,
        apiSecret: process.env.TWITTER_API_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET
    });
}


function prepareTenantDirectory() {
    if (!fs.existsSync(messagesDir)) {
        logger.info('Creating messages directory.')
        fs.mkdirSync(messagesDir, { recursive: true });
    }
    if (!fs.existsSync(imagesDir)) {
        logger.info('Creating images directory.')
        fs.mkdirSync(imagesDir, { recursive: true });
    }
    if (!fs.existsSync(allMessagesFilename)) {
        logger.info('Creating messages file.')
        fs.writeFileSync(allMessagesFilename, JSON.stringify([], null, 2));
    }
}


function checkAndProcessNewMessages() {

    const req = https.get(`${tenantBaseUrl}?format=json&action=search&limit=${LIMIT_MESSAGES_SYNC}`, res => {

        if (res.statusCode !== 200) {
            logFailedDataFetch(res.statusMessage);
            return;
        }

        let body = '';

        res.on('data', d => body += d);
        res.on('end', () => {

            // Get the messages that are currently available
            const currentMessages = JSON.parse(body);

            // Load all the messages we already know
            const pastMessages = loadPastMessages();

            // Check for messages we haven't seen yet
            const newMessages = findNewMessages(currentMessages, pastMessages);

            processNewMessages(pastMessages, newMessages)
                .then(() => logger.info('Run finished.'))
                .catch(e => logger.error('Run finished with errors.', e));

        });

    });
    req.on('error', e => logFailedDataFetch(e.message));
    req.end();

}


function loadPastMessages() {
    return JSON.parse(fs.readFileSync(allMessagesFilename, 'utf-8'));
}


function findNewMessages(currentMessages, pastMessages) {
    return currentMessages.filter(currentMessage => !pastMessages.some(pastMessage => pastMessage.id === currentMessage.id));
}


async function processNewMessages(pastMessages, newMessages) {

    if (newMessages.length === 0) {
        logger.info('No new messages to process.');
        return Promise.resolve();
    }

    logNewMessages(newMessages)
    recordNewMessages(pastMessages, newMessages);

    return enqueueAndProcessMessages(newMessages);

}


function recordNewMessages(pastMessages, newMessages) {
    const allMessages = pastMessages.concat(...newMessages);
    const strMessages = JSON.stringify(allMessages, null, 2);
    fs.writeFileSync(allMessagesFilename, strMessages);
}


async function enqueueAndProcessMessages(messages) {

    return new Promise(resolve => {
        messages
            .sort((a, b) => a.createdDate > b.createdDate ? -1 : 0)
            .reverse()
            .forEach(delay(processMessage, TWEET_DELAY_SECONDS * 1000));
        delay(resolve, TWEET_DELAY_SECONDS * 1000)(null, messages.length);
    });

}


function delay(fn, delay) {
    return (message, i) => {
        const sendTweet = i < MAX_TWEETS_PER_RUN;
        setTimeout(() => fn(message, sendTweet), i * delay);
    };
}


async function processMessage(message, doSendTweet) {

    let messageDetails = null;
    try {
        messageDetails = await fetchMessageDetails(message);
    } catch (e) {
        return logFailedDetailsFetch(e);
    }

    archiveMessageDetails(messageDetails);

    let imageData = null;
    if (messageDetails.messageImage) {

        try {
            imageData = await fetchImage(messageDetails);
        } catch (e) {
            return logFailedImageFetch(e);
        }

        try {
            await saveImage(messageDetails, imageData);
        } catch (e) {
            return logFailedImageSave(e);
        }

    }

    if (doSendTweet) {

        const localeOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
        const date = new Date(message.createdDate).toLocaleDateString('de-DE', localeOptions);
        const url = `${tenantBaseUrl}#meldungDetail?id=${message.id}`;
        let status = `Meldung vom ${date}:
    
${message.subject}
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

}


async function fetchMessageDetails(message) {

    logger.info(`Fetching details for message "${message.id}"`);

    return new Promise((resolve, reject) => {

        const req = https.get(`${tenantBaseUrl}?format=json&action=detail&id=${message.id}`, res => {

            if (res.statusCode !== 200) {
                return reject(res.statusMessage);
            }

            let body = '';

            res.on('data', d => body += d);
            res.on('end', () => {

                // Get the messages that are currently available
                const messageDetails = JSON.parse(body);
                if (messageDetails && messageDetails.length > 0) {
                    logger.info(`Received details for message "${message.id}"`);
                    resolve(messageDetails[0]);
                }

                return reject(`No details for message "${message.id}"`);

            });

        });
        req.on('error', e => reject(e.message));
        req.end();

    });

}


function archiveMessageDetails(message) {
    logger.info(`Archiving details for message "${message.id}"`);
    const filename = `${DATETIME_PREFIX}-message-${message.id}.json`;
    const strMessage = JSON.stringify(message, null, 2);
    fs.writeFileSync(`${messagesDir}/${filename}`, strMessage);
}


async function fetchImage(messageDetails) {

    logger.info(`Fetching image of message "${messageDetails.id}"`)

    return new Promise((resolve, reject) => {

        const imageId = messageDetails.messageImage.id;
        const req = https.get(`${baseUrl}/IWImageLoader?mediaId=${imageId}`, (res) => {

            if (res.statusCode !== 200) {
                return reject(res.statusMessage);
            }

            const imageData = [];

            res.on('data', d => imageData.push(d));
            res.on('end', () => {
                logger.info(`Received image of message "${messageDetails.id}"`);
                resolve(Buffer.concat(imageData));
            });

        });
        req.on('error', () => reject(e.message));
        req.end();

    });

}


function saveImage(messageDetails, imageDataBuffer) {
    logger.info(`Saving image of message "${messageDetails.id}"`);
    const mimeType = messageDetails.messageImage.mimeType;
    const fileExtension = mimeType === 'image/jpeg' ? '.jpeg' : (mimeType === 'image/png' ? '.png' : '');
    const filename = `${imagesDir}/${messageDetails.id}-${messageDetails.messageImage.id}${fileExtension}`;
    fs.writeFileSync(filename, imageDataBuffer);
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


function logFailedDataFetch(errorMessage) {
    const text = `Fetching data failed: ${errorMessage}`;
    logger.error(text);
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function logFailedDetailsFetch(errorMessage) {
    const text = `Fetching details failed: ${errorMessage}`;
    logger.error(text)
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function logFailedImageFetch(errorMessage) {
    const text = `Fetching image failed: ${errorMessage}`;
    logger.error(text);
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function logFailedImageSave(errorMessage) {
    const text = `Saving image failed: ${errorMessage}`;
    logger.error(text)
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function logNewMessages(messages) {
    const text = `Found new messages: ${messages.length}`;
    logger.info(text)
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
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
