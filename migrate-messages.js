
const fs = require('fs');
const { getMessageLocation } = require('./get-location');


function migrate(rootDir) {

    const tenants = fs.readdirSync(rootDir);

    for (const tenant of tenants) {

        console.log(tenant);

        if (!fs.existsSync(`${rootDir}/${tenant}/messages-migrated`)) {
            fs.mkdirSync(`${rootDir}/${tenant}/messages-migrated`);
        }

        const allMessagesTxt = fs.readFileSync(`${rootDir}/${tenant}/messages/all-messages.json`, 'utf-8');
        fs.writeFileSync(`${rootDir}/${tenant}/messages-migrated/all-messages.json`, allMessagesTxt, 'utf-8');

        const messageFilenames = fs.readdirSync(`${rootDir}/${tenant}/messages`).filter(filename => filename.startsWith('message-') && filename.endsWith('.json'));
        for (const messageFilename of messageFilenames) {
            const messageStr = fs.readFileSync(`${rootDir}/${tenant}/messages/${messageFilename}`, 'utf-8');
            const message = JSON.parse(messageStr);
            const convertedMessage = {
                id: `${message.id}`,
                tenantKey: tenant,
                providerKey: 'sue',
                location: getMessageLocation(message),
                data: message
            };
            fs.writeFileSync(`${rootDir}/${tenant}/messages-migrated/${messageFilename}`, JSON.stringify(convertedMessage, null, 2), 'utf-8');
        }

    }

}


migrate('./tenants');
migrate('./archive');
