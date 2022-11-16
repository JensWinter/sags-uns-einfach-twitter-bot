
const proj4 = initProj4();

function initProj4() {
    const proj4 = require('proj4');
    proj4.defs([
        ['EPSG:4326', '+title=WGS 84 (long/lat) +proj=longlat +ellps=WGS84 +datum=WGS84 +units=degrees'],
        ['EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs ']
    ]);
    return proj4;
}

function getMessageLocation(sueMessage) {

    const coordinateSystem = sueMessage.messagePosition?.geoCoding?.coordinateSystem;
    const hasCoordinates = coordinateSystem === 'EPSG:25832' || coordinateSystem === 'EPSG:4326';
    let lat = null;
    let long = null;
    if (hasCoordinates) {
        const coord = [sueMessage.messagePosition.geoCoding.longitude, sueMessage.messagePosition.geoCoding.latitude];
        if (coordinateSystem === 'EPSG:25832') {
            const destinationCoord = proj4('EPSG:25832', 'EPSG:4326', coord);
            lat = destinationCoord[1];
            long = destinationCoord[0];
        } else {
            lat = sueMessage.messagePosition.geoCoding.latitude;
            long = sueMessage.messagePosition.geoCoding.longitude;
        }
        return [long, lat];
    }

    return null;

}

module.exports = { getMessageLocation };
