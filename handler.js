'use strict';

const AWS = require('aws-sdk');
const uuid = require('uuid/v4');
const fileType = require('file-type');
const rp = require('request-promise');
const request = require('request');
AWS.config.setPromisesDependency(require('bluebird'));

const s3BasePath = 'https://sumitaudios.s3-us-west-2.amazonaws.com/';
const dynamoDb = new AWS.DynamoDB.DocumentClient();

module.exports.uploadAudio = (event, context, callback) => {
  var s3 = new AWS.S3();
  //console.log("body : " + event.body);
  var json = JSON.parse(event.body);
  const email = json.email || "fakeemail@gmail.com";
  console.log("email: " + email);
  const meetingID = json.meetingID || uuid();
  console.log("meeting id: " + meetingID);
  let base64String = json.file;
  let buffer = Buffer.from(base64String, 'base64');

  let fileMime = fileType(buffer);

  if (fileMime === null) {
    return context.fail("file type is not supported");
  }

  console.log("extension : " + fileMime.ext);

  var fileName = uuid() + '.' + fileMime.ext;

  var fileFullPath = s3BasePath + fileName;

  console.log('fileFullPath: ' + fileFullPath);

  var s3Params = {
    Bucket: 'sumitaudios',
    Key: fileName,
    Body: buffer,
    ContentType: 'audio/wav',
    ACL: 'public-read'
  };

  s3.putObject(s3Params).promise().then(() => {
    console.log("Uploaded to " + fileFullPath);
  }).then((res) => {
    let audioRecord = {
      MeetingId: meetingID,
      Email: email,
      s3AudioFile: fileFullPath
    }
    postToDDB(audioRecord).then(res => {
      callback(null, {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*' //probably only allow the AWS ec2 instance to access
        },
        body: JSON.stringify({ uploadURL: fileFullPath }),
      })
    })
  })
};

let postToDDB = audioRecord => {
  console.log('Submitting audioRecord' + JSON.stringify(audioRecord));
  console.log("table: " + process.env.ddbTable);
  const audioInfo = {
    TableName: process.env.ddbTable,
    Item: audioRecord,
  };
  return dynamoDb.put(audioInfo).promise()
    .then(res => audioInfo);
}

module.exports.summarize = async (event, context, callback) => {
  console.log('inside summarize');
  var json = JSON.parse(event.body);
  console.log('json: ' + json);
  var s3transcribedUrl = json.transcribeUrl;

  console.log("transcribeUrl: " + s3transcribedUrl);
  if (s3transcribedUrl === null) {
    console.log('No s3 url passed');
    context.fail("No s3 url passed");
  }

  var headers = {
    'User-Agent': 'Super Agent/0.0.1',
    'Content-Type': 'application/x-www-form-urlencoded'
  }

  var options = {
    uri: 'https://resoomer.pro/summarizer/',
    method: 'POST',
    headers: headers,
    form: { 'API_KEY': '80F0D9B0265ABD0F98E33EB9316A578C', 'url': s3transcribedUrl }
  }


  var options2 = {
    uri: s3transcribedUrl,
    headers: {
      'User-Agent': 'Request-Promise'
    },
    json: true // Automatically parses the JSON string in the response
  };

  var text = '';

  request.get(s3transcribedUrl, function (res, err) {
    if (err) {
      console.log(err);
      callback(null, {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*' //probably only allow the AWS ec2 instance to access
        },
        body: JSON.stringify({ ERROR: err }),
      })
    }
    else {
      console.log('response : ' + res);
      callback(null, {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*' //probably only allow the AWS ec2 instance to access
        },
        body: JSON.stringify({ summarizedS3Url: res }),
      })
    }
  });
  console.log("calling request");
  // Start the request
  // rp(options)
  //   .then((parsedBody) => {
  //     // POST succeeded...
  //     console.log("resoomer call successful, response: " + parsedBody);
  //     callback(null, {
  //       statusCode: 200,
  //       headers: {
  //         'Access-Control-Allow-Origin': '*' //probably only allow the AWS ec2 instance to access
  //       },
  //       body: JSON.stringify({ summarizedS3Url: "fakeUrl" }),
  //     })
  //   })
  //   .catch((err) => {
  //     // POST failed...
  //     console.log('resoomer call failed' + err);
  //     context.fail('resoomer call failed' + err);
  //   });
}


