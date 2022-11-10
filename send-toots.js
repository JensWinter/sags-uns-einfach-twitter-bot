'use strict';

const axios = require('axios');
const fs = require('fs');
const winston = require('winston');
const Mastodon = require('mastodon-api');


require('dotenv').config();


const tenant = initArgs();
if (!tenant) {
    console.error('Couldn\'t load tenant configuration.');
    process.exit(1);
}

const tenantKey = tenant.key;
const baseUrl = `https://include-${tenant.providers.sue.system}.zfinder.de`;
const tenantBaseUrl = `${baseUrl}/mobileportalpms/${tenant.providers.sue.id}`;

const tenantsDir = './tenants';
const tenantDir = `${tenantsDir}/${tenantKey}`;
const imagesDir = `${tenantDir}/images`;
const tootsDir = `${tenantDir}/toots`;
const queueNewMessagesDir = `${tenantDir}/queues/mastodon/new_messages`;
const queueResponseUpdatesDir = `${tenantDir}/queues/mastodon/response_updates`;
const queueStatisticsUpdatesDir = `${tenantDir}/queues/mastodon/statistics_updates`;

const logger = initLogger();
const mastodonClient = initMastodonClient();

const LOG_TO_SLACK_CHANNEL = tenant.config.logToSlackChannel;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;


(async () => {

    try {

        prepareTenantDirectory();

        const processNewMessageResult = await popAndProcessNewMessage();
        if (!processNewMessageResult) {
            await popAndProcessResponseUpdate();
        }

        await popAndProcessStatisticsUpdate();

    } catch (e) {
        logError(e);
    }

})();


function initArgs() {

    const yargs = require('yargs/yargs');
    const { hideBin } = require('yargs/helpers');
    const argv = yargs(hideBin(process.argv))
        .options({
            'h': {
                alias: 'help'
            },
            't': {
                alias: 'tenant',
                demandOption: true,
                type: 'string',
            }
        })
        .coerce('tenant', arg => {
            const tenants = JSON.parse(fs.readFileSync('./tenants.json', 'utf-8'));
            return tenants.find(t => t.config.active && t.key === arg);
        })
        .version()
        .argv;

    return argv.tenant;

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
            new winston.transports.File({ filename: `${tenantDir}/output-send-toots.log` }),
            new winston.transports.Console({ format: winston.format.simple() })
        ]
    });

}


function prepareTenantDirectory() {
    if (!fs.existsSync(tootsDir)) {
        logger.info('Creating toots directory.');
        fs.mkdirSync(tootsDir, { recursive: true });
    }
}


function initMastodonClient() {
    return new Mastodon({
        access_token: process.env.MASTODON_ACCESS_TOKEN,
        api_url: process.env.MASTODON_API_URL
    });
}


async function popAndProcessNewMessage() {

    const itemToProcess = fs
        .readdirSync(queueNewMessagesDir)
        .filter(f => f.startsWith('message-') && f.endsWith('.json'))
        .sort()
        .shift();

    if (itemToProcess) {

        logger.info(`Found new message to toot: ${itemToProcess}`);

        const message = loadNewMessageFromQueue(itemToProcess);
        const imageFilename = message.messageImage ? getImageFilename(message) : null;
        await processNewMessage(message, imageFilename);

        removeItemFromNewMessagesQueue(itemToProcess);

    }

    return itemToProcess;

}


function loadNewMessageFromQueue(filename) {
    return JSON.parse(fs.readFileSync(`${queueNewMessagesDir}/${filename}`, 'utf-8'));
}


function getImageFilename(messageDetails) {
    const mimeType = messageDetails.messageImage.mimeType;
    const fileExtension = mimeType === 'image/jpeg' ? '.jpeg' : (mimeType === 'image/png' ? '.png' : '');
    return `${imagesDir}/${messageDetails.id}-${messageDetails.messageImage.id}${fileExtension}`;
}


async function processNewMessage(message, imageFilename) {

    const localeOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
    const date = new Date(message.createdDate).toLocaleDateString('de-DE', localeOptions);
    const subject = message.subject.slice(0, imageFilename ? 444 : 463);
    const url = `${tenantBaseUrl}#meldungDetail?id=${message.id}`;

    let status = `${date}:

${subject}
${url}`;

    if (imageFilename) {
        const mediaId = await uploadImage(imageFilename);
        status += `
Bild: LH Magdeburg`;
        const sendTootResult = await sendNewMessageToot(status, mediaId);
        saveMessageToot(message, sendTootResult);
    } else {
        const sendTootResult = await sendNewMessageToot(status, null);
        saveMessageToot(message, sendTootResult);
    }

}


async function uploadImage(filename) {

    logger.info('Uploading image to Mastodon')

    const uploadResult = await mastodonClient.post('media', { file: fs.createReadStream(filename) });

    logger.info('Image successfully sent to Mastodon');

    return uploadResult.data.id;

}


async function sendNewMessageToot(status, mediaId) {

    logger.info('Sending toot...');
    logger.info(`...with status "${status}"`);
    if (mediaId) {
        logger.info(`...with media "${mediaId}"`);
    }

    const parameters = { status, media_ids: [mediaId] };
    const sendResult = await mastodonClient.post('statuses', parameters);

    if (sendResult.data.error) {
        throw new Error(sendResult.data.error);
    }

    logger.info(`Toot successfully sent. id = ${sendResult.data.id}`);

    return sendResult;

}


function removeItemFromNewMessagesQueue(filename) {
    logger.info(`Removing item "${filename}" from new messages queue`)
    fs.unlinkSync(`${queueNewMessagesDir}/${filename}`)
}


async function popAndProcessResponseUpdate() {

    const itemToProcess = fs
        .readdirSync(queueResponseUpdatesDir)
        .filter(f => f.startsWith('message-') && f.endsWith('.json'))
        .sort()
        .shift();

    if (itemToProcess) {

        logger.info(`Found response update to toot: ${itemToProcess}`);

        const message = loadResponseUpdateFromQueue(itemToProcess);
        const toots = loadToots(message);
        const lastToot = toots.pop();
        if (lastToot) {
            await processResponseUpdate(message, lastToot.data.id);
        } else {
            logger.warn(`Didn't send response update toot for message "${itemToProcess}", because origin toot couldn't be found.`);
        }

        removeItemFromResponseUpdatesQueue(itemToProcess);

    }

    return itemToProcess;

}


function loadResponseUpdateFromQueue(filename) {
    return JSON.parse(fs.readFileSync(`${queueResponseUpdatesDir}/${filename}`, 'utf-8'));
}


async function processResponseUpdate(message, replyToId) {

    const response = message.responses.sort((a, b) => b.messageDate - a.messageDate)[0];
    const localeOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
    const date = new Date(response.messageDate).toLocaleDateString('de-DE', localeOptions);
    const responseText = response.message.length > 485 ? `${response.message.slice(0, 480)}[...]` : response.message;
    let status = `${date}:

"${responseText}"`;
    const sendTootResult = await sendUpdateToot(status, replyToId);
    saveMessageToot(message, sendTootResult);

}


function removeItemFromResponseUpdatesQueue(filename) {
    logger.info(`Removing item "${filename}" from response updates queue`)
    fs.unlinkSync(`${queueResponseUpdatesDir}/${filename}`)
}


async function popAndProcessStatisticsUpdate() {

    const itemToProcess = fs
        .readdirSync(queueStatisticsUpdatesDir)
        .filter(f => f.startsWith('stats-') && f.endsWith('.txt'))
        .sort()
        .shift();

    if (itemToProcess) {

        logger.info(`Found statistics update to toot: ${itemToProcess}`);

        const text = loadStatisticsUpdateFromQueue(itemToProcess);
        await processStatisticsUpdate(text);

        removeItemFromStatisticsUpdatesQueue(itemToProcess);

    }

    return itemToProcess;

}


function loadStatisticsUpdateFromQueue(filename) {
    return fs.readFileSync(`${queueStatisticsUpdatesDir}/${filename}`, 'utf-8');
}


async function processStatisticsUpdate(text) {
    const sendTootResult = await sendWeekStatsToot(text);
    saveStatisticsToot(text, sendTootResult);
}


function removeItemFromStatisticsUpdatesQueue(filename) {
    logger.info(`Removing item "${filename}" from statistics updates queue`)
    fs.unlinkSync(`${queueStatisticsUpdatesDir}/${filename}`)
}


function loadToots(message) {
    const filename = `${tootsDir}/toots-${message.id}.json`;
    return fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf-8')) : [];
}


function saveMessageToot(message, tootResult) {
    const filename = `${tootsDir}/toots-${message.id}.json`;
    const toots = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf-8')) : [];
    toots.push(tootResult);
    const tootResultStr = JSON.stringify(toots, null, 2);
    fs.writeFileSync(filename, tootResultStr);
}


function saveStatisticsToot(text, tootResult) {
    const filename = `${tootsDir}/weekly-stats.json`;
    const toots = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf-8')) : [];
    toots.push(tootResult);
    const tootResultStr = JSON.stringify(toots, null, 2);
    fs.writeFileSync(filename, tootResultStr);
}


async function sendUpdateToot(status, replyToId) {

    logger.info('Sending toot...');
    logger.info(`...with status "${status}"`)

    const parameters = { status, in_reply_to_id: replyToId };
    const sendResult = await mastodonClient.post('statuses', parameters);

    if (sendResult.data.error) {
        throw new Error(sendResult.data.error);
    }

    logger.info(`Toot successfully sent. id = ${sendResult.data.id}`);

    return sendResult;

}


async function sendWeekStatsToot(status) {

    logger.info('Sending toot...');
    logger.info(`...with status "${status}"`)

    const sendResult = await mastodonClient.post('statuses', { status });

    if (sendResult.data.error) {
        throw new Error(sendResult.data.error);
    }

    logger.info(`Toot successfully sent. id = ${sendResult.data.id}`);

    return sendResult;

}


function logError(error) {
    const text = `ERROR: ${error}`;
    logger.error(text)
    if (LOG_TO_SLACK_CHANNEL) {
        sendToSlackChannel(text);
    }
}


function sendToSlackChannel(message) {
    const text = `${tenantKey}: ${message}`;
    const strData = JSON.stringify({ text });
    axios
        .post(SLACK_WEBHOOK_URL, strData)
        .catch(e => console.error(e));
}
