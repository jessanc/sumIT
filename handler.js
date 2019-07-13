'use strict';

const AWS = require('aws-sdk');
const uuid = require('uuid/v4');
const fileType = require('file-type');

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

  if(fileMime === null){
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
    ContentType : 'audio/wav',
    ACL: 'public-read'
  };

  s3.putObject(s3Params).promise().then(()=>{
    console.log("Uploaded to " + fileFullPath);
  }).then((res)=> {
    let audioRecord = {
      MeetingId : meetingID,
      Email : email,
      s3AudioFile : fileFullPath
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
  console.log('Submitting audioRecord'+ JSON.stringify(audioRecord));
  console.log("table: " + process.env.ddbTable);
  const audioInfo = {
    TableName: process.env.ddbTable,
    Item: audioRecord,
  };
  return dynamoDb.put(audioInfo).promise()
    .then(res => audioInfo);
}


