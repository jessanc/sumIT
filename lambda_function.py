from __future__ import print_function
import time
import boto3
import json
from botocore.vendored import requests

print('Loading function')

def lambda_handler(event, context):
    #print("Received event: " + json.dumps(event, indent=2))
    visited = {}
    
    for record in event['Records']:
        print(record['eventID'])
        print(record['eventName'])
        
        if record['eventName'] == 'INSERT': 
            dynamodb_record = record['dynamodb']
            meetingID = dynamodb_record['Keys']['MeetingId']['S']
            print("DynamoDB Record: " + json.dumps(dynamodb_record))
            
            if (meetingID in visited) and (visited[meetingID]):
                continue
            visited[meetingID] = True
            transcribe = boto3.client('transcribe')
    
            job_name = "transcribe_" + str(time.time()).replace(".", "") + str(meetingID)
            print("Job ID: ", job_name)
            job_uri = dynamodb_record['NewImage']['s3AudioFile']['S']
            print("This is the job URI audio file: ", job_uri)
            extension = job_uri[-3:]
            MediaFormat = extension if extension in ["mp3", "wav"] else 'mp4'
            print("EXTENSION", extension)
            print ("Starting transcribe job...")
        
            transcribe.start_transcription_job(
                TranscriptionJobName=job_name,
                Media={'MediaFileUri': job_uri},
                MediaFormat=MediaFormat, 
                LanguageCode='en-US',
                OutputBucketName='sumitaudiostext'
            )
            
            list_of_chunk_file_names = []
            
            print("Getting the transcribed file names...")
            breaking = False
            while True:
                status = transcribe.get_transcription_job(TranscriptionJobName=job_name)
                if status['TranscriptionJob']['TranscriptionJobStatus'] == 'COMPLETED':
                    objName = job_name + '.json'
                    list_of_chunk_file_names.append(objName)
                    break
                elif status['TranscriptionJob']['TranscriptionJobStatus'] == 'FAILED':
                    breaking = True
                    break
                time.sleep(3)
            
            if breaking:
                print("failed.")
                continue
            
            print ("The transcribed file names: ", list_of_chunk_file_names)
            
            # json_to_create = {}
            # print ("Converting to big file")
            # s3 = boto3.resource('s3')
            # for obj in list_of_chunk_file_names:
            #     content_object = s3.Object('sumitaudiostext', obj)
            #     file_content = content_object.get()['Body'].read().decode('utf-8')
            #     json_content = json.loads(file_content)
            #     json_to_create["accountId"] = json_content["accountId"]
            #     json_to_create["results"] = {}
            #     if "transcripts" in json_to_create["results"]:
            #         json_to_create["results"]["transcripts"][0]["transcript"] += json_content["results"]["transcripts"][0]["transcript"]
            #     else:
            #         json_to_create["results"]["transcripts"] = [{"transcript":json_content["results"]["transcripts"][0]["transcript"]}]
            #         # json_to_create["results"]["transcripts"][0]["transcript"] = json_content["results"]["transcripts"][0]["transcript"]
                    
            #     if "items" in json_to_create["results"]:
            #         for item in json_content["results"]["items"]:
            #             json_to_create["results"]["items"].append(item)
            #     else:
            #         json_to_create["results"]["items"] = json_content["results"]["items"]
            
            # big_file_name = 'Big_dump_'+str(time.time())+meetingID+'.json'     
            # s3object = s3.Object('sumitaudiostext', big_file_name)
            # s3object.put(Body=(bytes(json.dumps(json_to_create).encode('UTF-8'))))
            time.sleep(4)
            s3 = boto3.resource('s3')
            for s3files in list_of_chunk_file_names:
                object_acl = s3.ObjectAcl('sumitaudiostext', s3files)
                response = object_acl.put(ACL='public-read')
            
            s3url = "https://sumitaudiostext.s3-us-west-2.amazonaws.com/" + list_of_chunk_file_names[0]
            # print ("Uploaded the big file to S3.")
            print ("Adding the URL to DynamoDB")
            
            dynamo = boto3.client('dynamodb')
            dynamo.update_item(
                TableName='audios', 
                Key={
                    'MeetingId': {
                        'S': str(meetingID)
                    }
                }, 
                UpdateExpression="set s3TranscribedTextLink = :t", 
                ExpressionAttributeValues={
                    ':t': {
                        'S': str(s3url)
                    }
                }, 
                ReturnValues="UPDATED_NEW"
                )
            print ("Added to dynamo... Sending this to summarize.")
            API_ENDPOINT = "https://ofayilo7ug.execute-api.us-west-2.amazonaws.com/dev/summarize"
            data = {"transcribeUrl" : str(s3url), "meetingId" : str(meetingID)}
            response = requests.post(url = API_ENDPOINT, data = json.dumps(data)) 
            print("The response is:%s"%response.text)
        
    return 'Successfully processed {} records.'.format(len(event['Records']))
