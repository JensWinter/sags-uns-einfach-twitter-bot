'use strict';

const https = require('https');
const fs = require('fs');
const winston = require('winston');

require('dotenv').config();


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
const queueNewMessagesDir = `${tenantDir}/queue_new_messages`;
const queueResponseUpdatesDir = `${tenantDir}/queue_response_updates`;
const queueStatusUpdatesDir = `${tenantDir}/queue_status_updates`;

const logger = initLogger();

const LIMIT_MESSAGES_FETCH = config.limitMessagesFetch;
const PROCESS_DELAY_SECONDS = config.processDelaySeconds;
const MAX_QUEUE_SIZE = config.maxQueueSize;
const LOG_TO_SLACK_CHANNEL = config.logToSlackChannel;

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;


logger.info('Run initiated.')


prepareTenantDirectory();


fetchAndProcessMessages();


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
            new winston.transports.File({ filename: `${tenantDir}/output-fetch-messages.log` }),
            new winston.transports.Console({ format: winston.format.simple() })
        ]
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
    if (!fs.existsSync(queueNewMessagesDir)) {
        logger.info('Creating new messages queue directory.')
        fs.mkdirSync(queueNewMessagesDir, { recursive: true });
    }
    if (!fs.existsSync(queueResponseUpdatesDir)) {
        logger.info('Creating response updates queue directory.')
        fs.mkdirSync(queueResponseUpdatesDir, { recursive: true });
    }
    if (!fs.existsSync(queueStatusUpdatesDir)) {
        logger.info('Creating status updates queue directory.')
        fs.mkdirSync(queueStatusUpdatesDir, { recursive: true });
    }
}


function fetchAndProcessMessages() {

    const req = https.get(`${tenantBaseUrl}?format=json&action=search&limit=${LIMIT_MESSAGES_FETCH}`, res => {

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
                .then(() => {

                    logger.info('Processing new messages finished.');

                    // Check if there are any updates to already known messages
                    processMessageUpdates(currentMessages)
                        .then(() => logger.info('Processing message updates finished.'))
                        .catch(e => logger.error('Processing message updates finished with errors.', e));

                })
                .catch(e => logger.error('Processing new messages finished with errors.', e));

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

    return processNewMessagesDelayed(newMessages);

}


async function processMessageUpdates(currentMessages) {
    logger.info('Checking for message updates');
    return processMessageUpdatesDelayed(currentMessages);
}


function recordNewMessages(pastMessages, newMessages) {
    const allMessages = pastMessages.concat(...newMessages);
    const strMessages = JSON.stringify(allMessages, null, 2);
    fs.writeFileSync(allMessagesFilename, strMessages);
}


async function processNewMessagesDelayed(messages) {

    return new Promise(resolve => {
        messages
            .sort((a, b) => a.createdDate > b.createdDate ? -1 : 0)
            .reverse()
            .forEach(delayProcessMessage(processNewMessage, PROCESS_DELAY_SECONDS * 1000));
        delayProcessMessage(resolve, PROCESS_DELAY_SECONDS * 1000)(null, messages.length);
    });

}


async function processMessageUpdatesDelayed(messages) {

    return new Promise(resolve => {

        let index = 0;
        messages
            .sort((a, b) => a.lastUpdated > b.lastUpdated ? -1 : 0)
            .reverse()
            .forEach(message => {

                const filepath = `${messagesDir}/message-${message.id}.json`;
                if (fs.existsSync(filepath)) {
                    const oldMessage = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
                    if (message.lastUpdated > oldMessage.lastUpdated) {
                        delayProcessMessage(processMessageUpdate, PROCESS_DELAY_SECONDS * 1000)(oldMessage, index);
                        index++;
                    }
                }

            });

        delayProcessMessage(resolve, PROCESS_DELAY_SECONDS * 1000)(null, index);

    });

}


function delayProcessMessage(fn, delay) {
    return (message, i) => setTimeout(() => fn(message), i * delay);
}


async function processNewMessage(message) {

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

    if (MAX_QUEUE_SIZE > 0) {
        enqueueNewMessage(messageDetails);

        if (messageDetails.responses.length > 0) {
            enqueueResponseUpdate(messageDetails);
        }

        // Commented out because of #26 (https://github.com/JensWinter/sags-uns-einfach-twitter-bot/issues/26)
        /*
        // Special handling when published message was already closed
        if (messageDetails.status.toLowerCase() === 'closed') {
            enqueueStatusUpdate(messageDetails);
        }
        */
    }

}


async function processMessageUpdate(oldMessage) {

    const messageDetails = await fetchMessageDetails(oldMessage);

    archiveMessageDetails(messageDetails);

    if (oldMessage.responses.length < messageDetails.responses.length) {
        logger.info(`${messageDetails.responses.length - oldMessage.responses.length} new response(s) in message "${messageDetails.id}" `);
        if (MAX_QUEUE_SIZE > 0) {
            enqueueResponseUpdate(messageDetails);
        }
    }

    // Commented out because of #26 (https://github.com/JensWinter/sags-uns-einfach-twitter-bot/issues/26)
/*
    if (oldMessage.status !== messageDetails.status) {
        logger.info(`Status of message "${messageDetails.id}" changed from "${oldMessage.status}" to "${messageDetails.status}"`);
        if (MAX_QUEUE_SIZE > 0) {
            enqueueStatusUpdate(messageDetails);
        }
    }
*/

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
    const filename = `message-${message.id}.json`;
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


function enqueueNewMessage(messageDetails) {
    const currentQueueSize = fs.readdirSync(queueNewMessagesDir).length;
    if (currentQueueSize < MAX_QUEUE_SIZE) {
        logger.info(`Saving message "${messageDetails.id}" into new messages queue`);
        fs.writeFileSync(`${queueNewMessagesDir}/message-${messageDetails.id}.json`, JSON.stringify(messageDetails, null, 2));
    } else {
        logger.warn(`Didn't queue new message "${messageDetails.id}". Queue is full!`);
    }
}


function enqueueResponseUpdate(messageDetails) {
    const currentQueueSize = fs.readdirSync(queueResponseUpdatesDir).length;
    if (currentQueueSize < MAX_QUEUE_SIZE) {
        logger.info(`Saving response update for message "${messageDetails.id}" into response update queue`);
        fs.writeFileSync(`${queueResponseUpdatesDir}/message-${messageDetails.id}.json`, JSON.stringify(messageDetails, null, 2));
    } else {
        logger.warn(`Didn't queue response update for message "${messageDetails.id}". Queue is full!`);
    }
}


function enqueueStatusUpdate(messageDetails) {
    const currentQueueSize = fs.readdirSync(queueStatusUpdatesDir).length;
    if (currentQueueSize < MAX_QUEUE_SIZE) {
        logger.info(`Saving status update for message "${messageDetails.id}" into status update queue`);
        fs.writeFileSync(`${queueStatusUpdatesDir}/message-${messageDetails.id}.json`, JSON.stringify(messageDetails, null, 2));
    } else {
        logger.warn(`Didn't queue status update for message "${messageDetails.id}". Queue is full!`);
    }
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
