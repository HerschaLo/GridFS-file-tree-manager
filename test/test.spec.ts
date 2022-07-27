const chai = require("chai")

const expect = chai.expect
import fs from "fs"
import FolderTree from "../src/index"
import {MongoClient, GridFSBucket, GridFSFile, WithId, GridFSBucketReadStream, StreamDescription} from "mongodb"
import {Readable} from "stream"
import extract from "extract-zip"
const client = new MongoClient("mongodb://localhost:27017")

const dbName = "GridFS-folder-management-test"

const folderCollectionName = "folder-test"

const bucketName = "bucket-test"

const folderSystem = new FolderTree("mongodb://localhost:27017", dbName, bucketName, folderCollectionName)

describe("FolderTree", function(){
    it('should export the FolderTree class', function(){
        expect(FolderTree).to.exist
        expect(FolderTree).to.be.a('function')
        expect(FolderTree.prototype.deleteFile).to.exist
        expect(FolderTree.prototype.deleteFolder).to.exist
        expect(FolderTree.prototype.createFolder).to.exist
        expect(FolderTree.prototype.uploadFile).to.exist
        expect(FolderTree.prototype.getFileReadStream).to.exist
        expect(FolderTree.prototype.downloadFolder).to.exist

        expect(JSON.stringify(folderSystem.db)).to.be.equal(JSON.stringify(client.db(dbName)))
        expect(folderSystem.folderCollectionName).to.be.equal(folderCollectionName)
        expect(folderSystem.bucketName).to.be.equal(bucketName)
        expect(JSON.stringify(folderSystem.bucket)).to.be.equal(JSON.stringify(new GridFSBucket(client.db(dbName), {bucketName:bucketName})))
    })

    it('should allow users to upload files and track which version of a file is the latest', async function(){
        const fileId1 = await folderSystem.uploadFile(fs.createReadStream("./test/test.txt"), {name:"test.txt", chunkSize:1048576, customMetadata:{starred:false}})
    
        await client.connect()
        
        let file1 = (await folderSystem.bucket.find({_id:fileId1}).toArray())[0]
        expect(file1.filename).to.be.equal("test.txt") 
        expect(file1.metadata?.isLatest).to.be.equal(true)
        expect(file1.metadata?.path).to.be.equal("folder-test/test.txt") 
        expect(file1.metadata?.parentDirectory).to.be.equal(folderCollectionName) 
        expect(file1.metadata?.starred).to.be.equal(false) 
        
        const fileId2 = await folderSystem.uploadFile(fs.createReadStream("./test/test.txt"), {name:"test.txt", chunkSize:1048576, customMetadata:{starred:false}})
        
        let file2 = (await folderSystem.bucket.find({_id:fileId2}).toArray())[0]
        expect(file2.filename).to.be.equal("test.txt") 
        expect(file2.metadata?.isLatest).to.be.equal(true) 
        expect(file2.metadata?.path).to.be.equal("folder-test/test.txt") 
        expect(file2.metadata?.parentDirectory).to.be.equal(folderCollectionName) 

        file1 = (await folderSystem.bucket.find({_id:fileId1}).toArray())[0]
        expect(file1.filename).to.be.equal("test.txt") 
        expect(file1.metadata?.isLatest).to.be.equal(false) 
        expect(file1.metadata?.path).to.be.equal("folder-test/test.txt") 
        expect(file1.metadata?.parentDirectory).to.be.equal(folderCollectionName) 
        
        client.close() 
    })

    it('should track which version of a file is the latest', async function(){
        const fileId1 = await folderSystem.uploadFile(fs.createReadStream("./test/test.txt"), {name:"test.txt", chunkSize:1048576})
    
        await client.connect()
        
        
        const fileId2 = await folderSystem.uploadFile(fs.createReadStream("./test/test.txt"), {name:"test.txt", chunkSize:1048576})
        
        let file2 = (await folderSystem.bucket.find({_id:fileId2}).toArray())[0]
        expect(file2.filename).to.be.equal("test.txt") 
        expect(file2.metadata?.isLatest).to.be.equal(true) 
        expect(file2.metadata?.path).to.be.equal("folder-test/test.txt") 
        expect(file2.metadata?.parentDirectory).to.be.equal(folderCollectionName) 

        let file1 = (await folderSystem.bucket.find({_id:fileId1}).toArray())[0]
        expect(file1.filename).to.be.equal("test.txt") 
        expect(file1.metadata?.isLatest).to.be.equal(false) 
        expect(file1.metadata?.path).to.be.equal("folder-test/test.txt") 
        expect(file1.metadata?.parentDirectory).to.be.equal(folderCollectionName) 
        
        client.close() 
    })

    it('should throw error when uploading if user does not provide valid readable stream', async function(){
        let err: any = undefined

        try{
             // @ts-ignore: Unreachable code error
            await folderSystem.uploadFile("not a readable stream", {name:"test.txt", chunkSize:1048576})
        }

        catch(e){
            err = e
        }
        expect(err).to.exist

        expect(err.message).to.be.equal("Argument for parameter fileStream is not a valid readable stream")
    })

    it('should allow users to create folders', async function(){
        await client.connect()
        const folderId = (await folderSystem.createFolder("subfolder-test")).insertedId

        let folder = (await folderSystem.db.collection(folderSystem.folderCollectionName).find({_id:folderId}).toArray())[0]

        expect(folder.parentDirectory).to.be.equal("folder-test")
        expect(folder.path).to.be.equal("folder-test/subfolder-test")
        expect(folder.name).to.be.equal("subfolder-test")
       
        client.close()
    })

    it('should throw an error if the user tries to create a folder with a name that already exists in the current directory', async function(){
        await client.connect()
        let err: any = undefined
        
        try{
            await folderSystem.createFolder("subfolder-test")
        }
        catch(e){
            err = e
        }

        expect(err).to.exist
        expect(err.message).to.be.equal("Folder with this name already exists in the current directory")
        client.close()
    })

    it('should allow users to set the active directory', async function(){
        await client.connect()
        await folderSystem.changeDirectory("subfolder-test", true)
        expect(folderSystem.currentWorkingDirectory).to.be.equal("folder-test/subfolder-test")
        await folderSystem.changeDirectory("folder-test")
        expect(folderSystem.currentWorkingDirectory).to.be.equal("folder-test")
    })

    it('should throw an error if the user tries to set the active directory to a folder that does not exist', async function(){
        let err: any = undefined

        try{
            await folderSystem.changeDirectory("invalid-path")
        }

        catch(e: any){
            err = e
        }
        expect(err).to.exist

        expect(err.message).to.be.equal("Folder with path invalid-path does not exist")
    })

    it('should allow users to download files', async function(){
        await client.connect()
        const fileDataStream = await folderSystem.getFileReadStream("folder-test/test.txt")
        let data = ""

        fileDataStream.on("data",(chunk)=>{
            data+=chunk
        })

        await new Promise<void>((resolve, reject)=>{
            fileDataStream.on("end",()=>{
                resolve()
            })
        })

        expect(data).to.be.equal("Hello world")
        client.close()
    })

    it('should throw an error if a user tries to download a file that does not exist', async function(){
        
        let err: any = undefined

        try{
            await folderSystem.getFileReadStream("invalid-file-path")
        }

        catch(e){
            err = e
        }
        expect(err).to.exist

        expect(err.message).to.be.equal("File with path invalid-file-path does not exist")
    })

    it('should allow users to delete files', async function(){
        await client.connect()
        await folderSystem.deleteFile("folder-test/test.txt")
        expect(await folderSystem.bucket.find({"metadata.path":"folder-test/test.txt"}).hasNext()).to.be.equal(false)
        client.close()
    })

    it('should throw an error if a user tries to delete a file that does not exist', async function(){
        let err: any = undefined

        try{
            await folderSystem.deleteFile("invalid-file-path")
        }

        catch(e){
            err = e
        }
        expect(err).to.exist

        expect(err.message).to.be.equal("File with path invalid-file-path does not exist")
    })

    it('should allow users to download folders', async function(){
        await client.connect()
        await folderSystem.changeDirectory("subfolder-test", true)
        await folderSystem.uploadFile(fs.createReadStream("./test/test.txt"), {name:'test.txt', chunkSize:1048576})
        await folderSystem.uploadFile(fs.createReadStream("./test/test.PNG"), {name:'test.PNG', chunkSize:1048576})
        await folderSystem.createFolder("subfolder-test 2")
        await folderSystem.changeDirectory("subfolder-test 2", true)
        await folderSystem.uploadFile(fs.createReadStream("./test/test.txt"), {name:'test.txt', chunkSize:1048576})
        await folderSystem.createFolder("subfolder-test 3")
        await folderSystem.changeDirectory("subfolder-test 3", true)
        await folderSystem.uploadFile(fs.createReadStream("./test/test.txt"), {name:'test.txt', chunkSize:1048576})
        
        let zip: any = await folderSystem.downloadFolder("folder-test/subfolder-test", "nodebuffer")
        let readStream = Readable.from(zip)
        const writeStream = fs.createWriteStream("./test_output/test.zip")
        
        readStream.pipe(writeStream)

        await new Promise<void>((resolve)=>{
            writeStream.on("finish",()=>{
                resolve()
            })
        })

        await extract("./test_output/test.zip", {dir:process.cwd()+"\\test_output"})
        
        expect(fs.readFileSync("./test_output/test.txt").equals(fs.readFileSync("./test/test.txt"))).to.be.equal(true)
        expect(fs.readFileSync("./test_output/test.PNG").equals(fs.readFileSync("./test/test.PNG"))).to.be.equal(true)
        expect(fs.readFileSync("./test_output/subfolder-test 2/test.txt").equals(fs.readFileSync("./test/test.txt"))).to.be.equal(true)
        expect(fs.readFileSync("./test_output/subfolder-test 2/subfolder-test 3/test.txt").equals(fs.readFileSync("./test/test.txt"))).to.be.equal(true)
        


        await folderSystem.changeDirectory("folder-test")
        await folderSystem.uploadFile(fs.createReadStream("./test/test.txt"), {name:"test.txt", chunkSize:1048576})
        let zip2: any = await folderSystem.downloadFolder("folder-test", "nodebuffer")
        let readStream2 = Readable.from(zip2)
        const writeStream2 = fs.createWriteStream("./test_output_2/whole-collection-test.zip")
        
        readStream2.pipe(writeStream2)

        await new Promise<void>((resolve)=>{
            writeStream2.on("finish",()=>{
                resolve()
            })
        })

        await extract("./test_output_2/whole-collection-test.zip", {dir:process.cwd()+"\\test_output_2"})
        
        expect(fs.readFileSync("./test_output_2/subfolder-test/test.txt").equals(fs.readFileSync("./test/test.txt"))).to.be.equal(true)
        expect(fs.readFileSync("./test_output_2/test.txt").equals(fs.readFileSync("./test/test.txt"))).to.be.equal(true)
        expect(fs.readFileSync("./test_output_2/subfolder-test/test.PNG").equals(fs.readFileSync("./test/test.PNG"))).to.be.equal(true)
        expect(fs.readFileSync("./test_output_2/subfolder-test/subfolder-test 2/test.txt").equals(fs.readFileSync("./test/test.txt"))).to.be.equal(true)
        expect(fs.readFileSync("./test_output_2/subfolder-test/subfolder-test 2/subfolder-test 3/test.txt").equals(fs.readFileSync("./test/test.txt"))).to.be.equal(true)
        

        client.close()
    })

    it('should throw an error if the user tries to download a folder that does not exist', async function(){
        let err: any = undefined

        try{
            await folderSystem.downloadFolder("invalid-folder-path", "nodebuffer")
        }

        catch(e){
            err = e
        }
        expect(err).to.exist

        expect(err.message).to.be.equal("Folder with path invalid-folder-path does not exist")
    })

    it('should throw an error if the user provides an invalid argument for returnType when trying to download a folder', async function(){
        let err: any = undefined

        try{
            // @ts-ignore
            await folderSystem.downloadFolder("folder-test", "wadw")
        }

        catch(e){
            err = e
        }
        expect(err).to.exist

        expect(err.message).to.be.equal(`Invalid argument for parameter returnType. Argument must either be 'base64','nodebuffer', 'array', 'uint8array','arraybuffer', 'blob', or 'binarystring'.`)
    })

    it('should allow users to delete folders', async function(){
        await client.connect()
       
        await folderSystem.deleteFolder("folder-test/subfolder-test")
        expect(Boolean(await folderSystem.db.collection(folderCollectionName).findOne({"path":"folder-test/subfolder-test"}))).to.be.equal(false)
        expect(Boolean(await folderSystem.db.collection(folderCollectionName).findOne({"path":"folder-test/subfolder-test/subfolder-test 2"}))).to.be.equal(false)
        expect(Boolean(await folderSystem.db.collection(folderCollectionName).findOne({"path":"folder-test/subfolder-test/subfolder-test 2/subfolder-test 3"}))).to.be.equal(false)
        expect(await folderSystem.db.collection(bucketName+".files").find({"metadata.path":"folder-test/subfolder-test/test.txt"}).hasNext()).to.be.equal(false)
        expect(await folderSystem.db.collection(bucketName+".files").find({"metadata.path":"folder-test/subfolder-test/test.PNG"}).hasNext()).to.be.equal(false)
        expect(await folderSystem.db.collection(bucketName+".files").find({"metadata.path":"folder-test/subfolder-test/subfolder-test 2/test.txt"}).hasNext()).to.be.equal(false)
        expect(await folderSystem.db.collection(bucketName+".files").find({"metadata.path":"folder-test/subfolder-test/subfolder-test 2/subfolder-test 3/test.txt"}).hasNext()).to.be.equal(false)

        client.close()
    })

    it('should throw an error if the user tries to delete a folder that does not exist', async function(){
        await client.connect()
        let err: any = undefined

        try{
            await folderSystem.deleteFolder("invalid-folder-path")
        }

        catch(e){
            err = e
        }
        expect(err).to.exist

        expect(err.message).to.be.equal("Folder with path invalid-folder-path does not exist")
        client.close()
    })


})