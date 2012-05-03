/**
 * Google Reader starred grabber
 *
 * @author  Mikhail Davydov
 * @licence MIT
 *
 * @example
 *      node favs.js -db favs.json -e your_google_login -p your_google_password -l
 *
 * @format database item:
 *      "google_reader_item_id": { // tag:google.com,2005:reader/item/ddc705e8894acac5
 *          original: "http://original.source.com/path/to/page.html",
 *          images: ["http://pewpew.com/ololo.jpg"]
 *      }
 *
 * @see parseStarred for format details
 *
 * Note: create 2-step auth password for security reasons
 */

// parse argv
var args =
    // @see https://gist.github.com/1497865
    (function(a,b,c,d){c={};for(a=a.split(/\s*\B[\/-]+([\w-]+)[\s=]*/),d=1;b=a[d++];c[b]=a[d++]||!0);return c})
    (process.argv.join(' '));

// email
args.e = args.e || args.email || null;

// password
args.p = args.p || args.pasword || null;

// log?
args.l = args.l || args.log || false;

// path to database
args.db = args.db || args.database || false;

var https = require('https'),
    http = require('http'),
    querystring = require('querystring'),
    fs = require('fs');

var MAX_REQUESTS = Infinity,
    APP_NAME = 'azproduction-starred-grabber';

var authHash = null,
    authToken = null,
    performedRequests = 0,
    bytesSaved = 0,
    itemsAdded = 0;

var starredItems = {};

/**
 * log factory
 *
 * @param str
 * @return {Function}
 */
function log(str) {
    return function (next) {
        if (args.l) {
            process.stdout.write(str);
        }
        next();
    };
}

/**
 * Perfosms login using email and password from argv saves authHash
 *
 * @param next
 */
function login(next) {
    var options = {
        host: 'www.google.com',
        port: 443,
        path: '/accounts/ClientLogin',
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    };

    var req = https.request(options, function (res) {
        var body = '';
        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            body += chunk;
        });

        res.on('end', function () {
            // parse body
            authHash = querystring.parse(body, '\n', '=').Auth;
            if (!authHash) {
                console.log('ERROR\nno Auth hash');
                return;
            }
            next();
        });
    });

    req.on('error', function(e) {
        console.log('ERROR\nproblem with request: ' + e.message);
    });

    // write data to request body
    var body = querystring.stringify({
        'Email': args.e,
        'Passwd':  args.p,
        'service': 'reader',
        'source': APP_NAME
    });

    req.write(body);
    req.end();
}

/**
 * Getting reader session token using authHash from login()
 *
 * @param next
 */
function token(next) {
    var options = {
        host: 'www.google.com',
        port: 80,
        path: '/reader/api/0/token',
        method: 'GET',
        headers: {
            'Authorization': 'GoogleLogin auth=' + authHash
        }
    };

    var req = http.request(options, function (res) {
        var body = '';
        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            body += chunk;
        });

        res.on('end', function () {
            authToken = body;
            if (!authToken) {
                console.log('ERROR\nno Token');
                return;
            }
            next();
        });
    });

    req.on('error', function(e) {
        console.log('ERROR\nproblem with request: ' + e.message);
    });

    req.end();
}

/**
 * Patches database item
 *
 * @param data
 * @return {Object} patched data
 */
function patchItem(data) {
    if ((/^http:\/\/(?:www\.)?photosight\.ru/).test(data.original) && data.images) {
        for (var i = 0, c = data.images.length; i < c; i++) {
            data.images[i] = data.images[i].replace('_thumb', '_large');
        }
    }

    return data;
}

/**
 * Parses getStarred responce
 *
 * @param  {String}         jsonString
 * @return {String|Boolean} returns continuation hash or false if no more pages
 */
function parseStarred(jsonString) {
    var data = JSON.parse(jsonString);

    if (!data.items || !data.items.length) {
        return false;
    }

    for (var i = 0, c = data.items.length, item; i < c; i++) {
        item = data.items[i];
        if (starredItems[item.id]) {
            return false;
        }

        starredItems[item.id] = patchItem({
            // save original
            original: item.alternate &&
                      item.alternate.length &&
                      item.alternate[0].href,

            // grab only images
            images: item.summary &&
                    item.summary.content &&
                    item.summary.content.match(/http:\/\/[^"\s]+\.(jpg|gif|png|jpeg)/g)
        });

        itemsAdded++;
    }

    return data.continuation || false;
}

/**
 * Requests and parses starred items
 *
 * @param next
 * @param {String} [continuation] pass if its an "next page" request
 */
function getStarred(next, continuation) {
    performedRequests++;
    if (performedRequests > MAX_REQUESTS) {
        next();
        return;
    }

    if (args.l) {
        process.stdout.write('\rGetting starred...' + performedRequests + '/' + itemsAdded);
    }

    var query = {
            'client': APP_NAME,
            'T': authToken
        };

    if (continuation) {
        query.c = continuation;
    }

    query = querystring.stringify(query);

    var options = {
        host: 'www.google.com',
        port: 80,
        path: '/reader/api/0/stream/contents/user/-/state/com.google/starred?' + query,
        method: 'GET',
        headers: {
            'Authorization': 'GoogleLogin auth=' + authHash
        }
    };

    var req = http.request(options, function (res) {
        var body = '';
        res.setEncoding('utf8');

        res.on('data', function (chunk) {
            body += chunk;
        });

        res.on('end', function () {
            var continuation = parseStarred(body);
            if (!continuation) {
                next();
            } else {
                getStarred(next, continuation);
            }
        });
    });

    req.on('error', function(e) {
        console.log('ERROR\nproblem with request: ' + e.message);
    });

    req.end();
}

/**
 * Backups database
 *
 * @param next
 */
function backup(next) {
    if (!args.db) {
        next();
        return;
    }

    fs.rename(args.db, args.db + '.backup', function (err) {
        if (err) throw err;
        next();
    });
}

/**
 * Saves new database
 *
 * @param next
 */
function saveDatabase(next) {
    if (!args.db) {
        next();
        return;
    }
    var json = JSON.stringify(starredItems);

    bytesSaved = json.length;
    fs.writeFile(args.db, json, function (err) {
        if (err) throw err;
        next();
    });
}

/**
 * Reads database
 * @param next
 */
function readDatabase(next) {
    if (!args.db) {
        next();
        return;
    }

    fs.readFile(args.db, 'utf8', function (err, data) {
        if (err) throw err;
        try {
            starredItems = JSON.parse(data);
        } catch (e) {
            starredItems = {};
        }
        next();
    });
}

/**
 * Prints grabbing results
 *
 * @param next
 */
function results(next) {
    if (args.l) {
        console.log(querystring.stringify({
            'Requests': performedRequests,
            'Items': itemsAdded,
            'Bytes': bytesSaved
        }, '\n', ': '));
    }

    next();
}

var sequence = [
    log('Reading database...'),
        readDatabase,
            log('OK\n'),

    log('Login...'),
        login,
            log('OK\n'),

    log('Token...'),
        token,
            log('OK\n'),

    log('Getting starred...'),
        getStarred,
            log('\nGetting starred...OK\n'),

    log('Backuping...'),
        backup,
            log('OK\n'),

    log('Writing...'),
        saveDatabase,
            log('OK\n'),

    results
];


(function step() {
    var item = sequence.shift();
    item && item(step);
}());