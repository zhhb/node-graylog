var zlib = require('zlib')
  , dgram = require('dgram')
  , util = require('util')
  , dns = require('dns')
  , isIp = /\b(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/;

GLOBAL.LOG_EMERG=0;    // system is unusable
GLOBAL.LOG_ALERT=1;    // action must be taken immediately
GLOBAL.LOG_CRIT=2;     // critical conditions
GLOBAL.LOG_ERR=3;      // error conditions
GLOBAL.LOG_ERROR=3;    // because people WILL typo
GLOBAL.LOG_WARNING=4;  // warning conditions
GLOBAL.LOG_NOTICE=5;   // normal, but significant, condition
GLOBAL.LOG_INFO=6;     // informational message
GLOBAL.LOG_DEBUG=7;    // debug-level message

GLOBAL.graylogHost = 'localhost';
GLOBAL.graylogPort = 12201;
GLOBAL.graylogHostname = require('os').hostname();
GLOBAL.graylogToConsole = false;
GLOBAL.graylogFacility = 'Node.js';
GLOBAL.graylogSequence = 0;
GLOBAL.graylogChunkSize = 8192; // 8192 is the maximum

function generateMessageId() {
	return '' + (Date.now() + Math.floor(Math.random()*10000));
}

function _logToConsole(shortMessage, opts) {
	var consoleString = shortMessage
	  , additionalFields = [];

	if (opts.full_message) {
		consoleString+=" ("+opts.full_message+")\n";
	}

	Object.keys(opts).forEach(function(key) {
		if (key[0]=='_' && key!="_logSequence") {
			additionalFields.push(
				"  " +
				key.substr(1,1024) +
				": " +
				'\033[' + 34 + 'm' + 
				opts[key] +
				'\033[' + 39 + 'm'
			);
		}
	});

	if (additionalFields.length>0) {
		consoleString+="\n"+additionalFields.join("\n");
	}

	util.log(consoleString);
}

function log(shortMessage, a, b) {
	var opts = {};
	if (typeof a == 'string'){
		opts = b || {};
		opts.full_message=a;
	} else if (typeof a == 'object') {
		opts = a || {};
	}

	opts.version="1.0";
	opts.timestamp = opts.timestamp || new Date().getTime()/1000 >> 0;
	opts.host = opts.host || GLOBAL.graylogHostname;
	opts.level = opts.level !== undefined ? opts.level : GLOBAL.LOG_INFO;
	opts.facility = opts.facility || GLOBAL.graylogFacility;

	if (opts.stack) {
		retrieveFileInfo(opts);
	}

	if (GLOBAL.graylogSequence) {
		opts['_logSequence'] = GLOBAL.graylogSequence++;
	}

	opts.short_message = shortMessage;
	
	if (GLOBAL.graylogToConsole) { 
		_logToConsole(shortMessage, opts);
	}

	var message = new Buffer(JSON.stringify(opts));
	zlib.deflate(message, function (err, compressedMessage) {
		if (err) {
			return;
		}

		var graylog2Client = dgram.createSocket("udp4")
		  , send = function(addr) {
				graylog2Client.send(compressedMessage, 0, compressedMessage.length, GLOBAL.graylogPort, addr, function (err, byteCount) {
					graylog2Client.close();
				});
			};

		if (compressedMessage.length > GLOBAL.graylogChunkSize) {
			var messageId = generateMessageId()
			  , sequenceSize = Math.ceil(compressedMessage.length / GLOBAL.graylogChunkSize)
			  , byteOffset = 0
			  , chunksWritten = 0
			  , send = function(addr) {
					for(var sequence=0; sequence<sequenceSize; sequence++) {
						var chunkBytes = (byteOffset + GLOBAL.graylogChunkSize) < compressedMessage.length ? GLOBAL.graylogChunkSize : (compressedMessage.length - byteOffset)
						  , chunk = new Buffer(chunkBytes + 12);

						chunk[0] = 0x1e;
						chunk[1] = 0x0f;
						chunk.write(messageId, 2, 8, 'ascii');
						chunk[10] = sequence;
						chunk[11] = sequenceSize;
						compressedMessage.copy(chunk, 12, byteOffset, byteOffset+chunkBytes);

						byteOffset += chunkBytes;
						
						graylog2Client.send(chunk, 0, chunk.length, GLOBAL.graylogPort, addr, function (err, byteCount) {
							chunksWritten++;
							if (chunksWritten == sequenceSize) {
								graylog2Client.close();
							}
						});
					}
			  }

			if (sequenceSize > 128) {
				util.debug("Graylog oops: log message is larger than 128 chunks, I print to stderr and give up: \n" + message.toString());
				return;
			}
		}

		!isIp.test(GLOBAL.graylogHost) 
		?	dns.resolve4(GLOBAL.graylogHost, function(dnsErr, addr) {
				if (dnsErr) 
					return

				send(addr[0]);
			})
		:	send(GLOBAL.graylogHost);
	});
}

/**
 * Retrieves the filename and line number where log() was called
 *
 * @param {Object} opts The options object that will be altered with 'file' and 'line' properties
 */
function retrieveFileInfo(opts){
	var err = new Error("test"),
		stack = (err.stack || "").toString().split(/\r?\n/),
		match;

	for(var i=0, len = stack.length; i<len; i++){
		if((match = stack[i].match(/^\s*at\s[^\(]+\(([^\):]+):(\d+):\d+\)/))){
			if(__filename.substr(-match[1].length) == match[1]){
				continue;
			}
			opts.file = match[1];
			opts.line = Number(match[2]) || 0;
			break;
		}
	}

}

GLOBAL.log = log;

