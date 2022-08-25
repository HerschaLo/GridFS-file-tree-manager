import chai from "chai"

const expect = chai.expect
import fs from "fs"
import MongoFileTree from "../src/index"
import {MongoClient, GridFSBucket} from "mongodb"
import {Readable} from "stream"
import extract from "extract-zip"
const client = new MongoClient("mongodb://localhost:27017")

const dbName = "GridFS-file-tree-management-test"

const folderCollectionName = "folder-test"

const bucketName = "bucket-test"

const folderSystem = new MongoFileTree("mongodb://localhost:27017", dbName, bucketName, folderCollectionName)

describe("MongoFileTree", function(){
    it('should allow users to upload files', async ()=>{
        const fileId = await folderSystem.uploadFile(fs.createReadStream(process.cwd()+"/test/test.txt"), {name:"test.txt", chunkSize:1048576, customMetadata:{starred:false}})

        await folderSystem.client.connect()

        const file1 = (await folderSystem.bucket.find({_id:fileId}).toArray())[0]
        expect(file1.filename).to.be.equal("test.txt")
        expect(file1.metadata?.isLatest).to.be.equal(true)
        expect(file1.metadata?.path).to.be.equal("folder-test/test.txt")
        expect(file1.metadata?.parentDirectory).to.be.equal(folderCollectionName)
        expect(file1.metadata?.starred).to.be.equal(false)

        folderSystem.client.close()
    })

    it('should track which version of a file is the latest', async ()=>{
        const fileId1 = await folderSystem.uploadFile(fs.createReadStream(process.cwd()+"/test/test.txt"), {name:"test.txt", chunkSize:1048576})

        await folderSystem.client.connect()


        const fileId2 = await folderSystem.uploadFile(fs.createReadStream(process.cwd()+"/test/test.txt"), {name:"test.txt", chunkSize:1048576})

        const file2 = (await folderSystem.bucket.find({_id:fileId2}).toArray())[0]
        expect(file2.filename).to.be.equal("test.txt")
        expect(file2.metadata?.isLatest).to.be.equal(true)
        expect(file2.metadata?.path).to.be.equal("folder-test/test.txt")
        expect(file2.metadata?.parentDirectory).to.be.equal(folderCollectionName)

        const file1 = (await folderSystem.bucket.find({_id:fileId1}).toArray())[0]
        expect(file1.filename).to.be.equal("test.txt")
        expect(file1.metadata?.isLatest).to.be.equal(false)
        expect(file1.metadata?.path).to.be.equal("folder-test/test.txt")
        expect(file1.metadata?.parentDirectory).to.be.equal(folderCollectionName)

        folderSystem.client.close()
    })

    it('should throw error when uploading if user does not provide valid readable stream, the file name contains invalid characters, or the user is missing properties from the "options" parameter', async ()=>{
        let err: any

        try{
             // @ts-ignore
            await folderSystem.uploadFile("not a readable stream", {name:"test.txt", chunkSize:1048576})
        }

        catch(e){
            err = e
        }

        expect(err.message).to.be.equal("Argument for parameter fileStream is not a valid readable stream")

        err = undefined
        try{
            // @ts-ignore
           await folderSystem.uploadFile(fs.createReadStream(process.cwd()+"/test/test.txt"), {name:"test/txt", chunkSize:1048576})
        }

        catch(e){
            err = e
        }

        expect(err.message).to.be.equal(`Character "/" cannot be used as part of a file name`)
        
        err = undefined
        try{
            // @ts-ignore
           await folderSystem.uploadFile(fs.createReadStream(process.cwd()+"/test/test.txt"), {chunkSize:1048576})
        }

        catch(e){
            err = e
        }

        expect(err.message).to.be.equal(`Missing 'name' property for 'options' parameter.`)
        
        err = undefined
        try{
            // @ts-ignore
           await folderSystem.uploadFile(fs.createReadStream(process.cwd()+"/test/test.txt"), {name:"test/txt"})
        }

        catch(e){
            err = e
        }

        expect(err.message).to.be.equal(`Missing 'chunkSize' property for 'options' parameter.`)
        
        folderSystem.client.close()
    })

    it('should allow users to create folders', async ()=>{
        await folderSystem.client.connect()
        const folderId = (await folderSystem.createFolder("subfolder-test")).insertedId
        const folder = (await folderSystem.db.collection(folderSystem.folderCollectionName).find({_id:folderId}).toArray())[0]

        expect(folder.parentDirectory).to.be.equal("folder-test")
        expect(folder.path).to.be.equal("folder-test/subfolder-test")
        expect(folder.name).to.be.equal("subfolder-test")

        folderSystem.client.close()
    })

    it('should throw an error if the user tries to create a folder with a name that already exists in the current directory or has invalid characters in its name', async ()=>{
        await folderSystem.client.connect()
        let err: any

        try{
            await folderSystem.createFolder("subfolder-test")
        }
        catch(e){
            err = e
        }

        expect(err.message).to.be.equal("Folder with name subfolder-test already exists in the current directory")
        err = undefined

        try{
            await folderSystem.createFolder("subfolder-test ")
        }
        catch(e){
            err = e
        }

        expect(err.message).to.be.equal(`Character " " cannot be used as part of a folder name`)
        folderSystem.client.close()
    })

    it('should allow users to set the current working directory', async ()=>{
        await folderSystem.client.connect()
        await folderSystem.changeDirectory("subfolder-test", true)
        expect(folderSystem.currentWorkingDirectory).to.be.equal("folder-test/subfolder-test")
        await folderSystem.changeDirectory("folder-test")
        expect(folderSystem.currentWorkingDirectory).to.be.equal("folder-test")
        folderSystem.client.close()
    })

    it('should throw an error if the user tries to set the current working directory to a folder that does not exist', async ()=>{
        await folderSystem.client.connect()
        let err: any

        try{
            await folderSystem.changeDirectory("invalid-path")
        }

        catch(e: any){
            err = e
        }

        expect(err.message).to.be.equal("Folder with path invalid-path does not exist")
        folderSystem.client.close()
    })

    it('should allow users to change the name of a file', async ()=>{
        await folderSystem.client.connect()
        await folderSystem.uploadFile(fs.createReadStream(process.cwd()+"/test/test.txt"), {name:"test-2.txt", chunkSize:1048576})
        console.log(process.cwd())
        await folderSystem.uploadFile(fs.createReadStream(process.cwd()+"/test/test.txt"), {name:"test-2.txt", chunkSize:1048576})
        await folderSystem.changeFileName("new-file-name.txt", "folder-test/test-2.txt")
        expect((await folderSystem.bucket.find({"metadata.path":"folder-test/new-file-name.txt"}).toArray()).length).to.be.equal(2)
        expect((await folderSystem.bucket.find({"metadata.path":"folder-test/test-2.txt"}).toArray()).length).to.be.equal(0)
        folderSystem.client.close()
    })

    it('should throw an error if the user tries to change the name of a file that does not exist or the new name contains invalid characters', async ()=>{
        await folderSystem.client.connect()
        let err: any

        try{
            await folderSystem.changeFileName("new-file-name.txt", "invalid-path")
        }

        catch(e: any){
            err = e
        }

        expect(err.message).to.be.equal("File with path invalid-path does not exist")
        err = undefined

        try{
            await folderSystem.changeFileName("invalid-name/", "folder-test/new-file-name.txt")
        }

        catch(e: any){
            err = e
        }

        expect(err.message).to.be.equal(`Character "/" cannot be used as part of a file name`)
        folderSystem.client.close()
    })

    it('should allow users to download files', async ()=>{
        await folderSystem.client.connect()
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
        folderSystem.client.close()
    })

    it('should throw an error if a user tries to download a file that does not exist', async ()=>{

        let err: any

        try{
            await folderSystem.getFileReadStream("invalid-file-path")
        }

        catch(e){
            err = e
        }

        expect(err.message).to.be.equal("File with path invalid-file-path does not exist")
        folderSystem.client.close()
    })

    it('should allow users to change the metadata of files', async ()=>{
        await folderSystem.changeFileMetadata("folder-test/test.txt", {favourite:true, encoding:"UTF-8"})
        expect((await folderSystem.bucket.find({"metadata.path":"folder-test/test.txt", "metadata.favourite":true, "metadata.encoding":"UTF-8"}).toArray()).length).to.be.equal(1)
        await folderSystem.changeFileMetadata("folder-test/test.txt", {}, ["encoding"])
        expect((await folderSystem.bucket.find({"metadata.path":"folder-test/test.txt", "metadata.favourite":true, "metadata.encoding":{$exists:false}}).toArray()).length).to.be.equal(1)
        await folderSystem.changeFileMetadata("folder-test/test.txt", {encoding:"UTF-8"}, ["favourite"], true)
        expect((await folderSystem.bucket.find({"metadata.path":"folder-test/test.txt", "metadata.encoding":"UTF-8"}).toArray()).length).to.be.equal(3)
        expect(await folderSystem.bucket.find({"metadata.path":"folder-test/test.txt", "metadata.favourite":true}).hasNext()).to.be.equal(false)
        folderSystem.client.close()
    })

    it("should raise an error if the user tries to change the 'isLatest', 'path', or 'parentDirectory' metadata properties on files", async ()=>{
        await folderSystem.client.connect()
        let err: any

        try{
            await folderSystem.changeFileMetadata("folder-test/test.txt", {path:true})
        }

        catch(e: any){
            err = e
        }

        expect(err.message).to.be.equal("Cannot change or delete 'path' metadata property using this method")
        err = undefined

        try{
            await folderSystem.changeFileMetadata("folder-test/test.txt", {parentDirectory:true})
        }

        catch(e: any){
            err = e
        }

        expect(err.message).to.be.equal("Cannot change or delete 'parentDirectory' metadata property using this method")
        err = undefined

        try{
            await folderSystem.changeFileMetadata("folder-test/test.txt", {isLatest:true})
        }

        catch(e: any){
            err = e
        }

        expect(err.message).to.be.equal("Cannot delete or change the type of 'isLatest' metadata property using this method")
        folderSystem.client.close()
    })

    it('should allow users to change the metadata of folders', async ()=>{
        await folderSystem.changeFolderMetadata("folder-test/subfolder-test", {favourite:true})
        expect((await folderSystem.db.collection(folderCollectionName).find({"path":"folder-test/subfolder-test", "customMetadata.favourite":true}).toArray()).length).to.be.equal(1)
        await folderSystem.changeFolderMetadata("folder-test/subfolder-test", {folderType:"work"}, ["favourite"])
        expect((await folderSystem.db.collection(folderCollectionName).find({"path":"folder-test/subfolder-test", "customMetadata.folderType":"work"}).toArray()).length).to.be.equal(1)
        expect(await folderSystem.bucket.find({"path":"folder-test/subfolder-test", "customMetadata.favourite":true}).hasNext()).to.be.equal(false)
        folderSystem.client.close()
    })

    it("should raise an error if the user tries to change the 'isLatest', 'path', or 'parentDirectory' metadata properties on folders", async ()=>{
        await folderSystem.client.connect()
        let err: any

        try{
            await folderSystem.changeFolderMetadata("folder-test/subfolder-test", {path:true})
        }

        catch(e: any){
            err = e
        }

        expect(err.message).to.be.equal("Cannot change or delete 'path' metadata property using this method")
        err = undefined

        try{
            await folderSystem.changeFolderMetadata("folder-test/subfolder-test", {parentDirectory:true})
        }

        catch(e: any){
            err = e
        }

        expect(err.message).to.be.equal("Cannot change or delete 'parentDirectory' metadata property using this method")
        err = undefined

        try{
            await folderSystem.changeFolderMetadata("folder-test/subfolder-test", {isLatest:true})
        }

        catch(e: any){
            err = e
        }

        expect(err.message).to.be.equal("Cannot add or delete 'isLatest' metadata property for a folder")
        folderSystem.client.close()
    })

    it('should allow users to delete files', async ()=>{
        await folderSystem.client.connect()
        await folderSystem.deleteFile("folder-test/test.txt")
        expect(await folderSystem.bucket.find({"metadata.path":"folder-test/test.txt"}).hasNext()).to.be.equal(false)
        folderSystem.client.close()
    })

    it('should throw an error if a user tries to delete a file that does not exist', async ()=>{
        let err: any

        try{
            await folderSystem.deleteFile("invalid-file-path")
        }

        catch(e){
            err = e
        }

        expect(err.message).to.be.equal("File with path invalid-file-path does not exist")
        folderSystem.client.close()
    })

    it('should allow users to download folders', async ()=>{
        await folderSystem.client.connect()
        await folderSystem.changeDirectory("subfolder-test", true)
        await folderSystem.uploadFile(fs.createReadStream(process.cwd()+"/test/test.txt"), {name:'test.txt', chunkSize:1048576})
        await folderSystem.uploadFile(fs.createReadStream(process.cwd()+"/test/test.PNG"), {name:'test.PNG', chunkSize:1048576})
        await folderSystem.createFolder("subfolder-test-2")
        await folderSystem.changeDirectory("subfolder-test-2", true)
        await folderSystem.uploadFile(fs.createReadStream(process.cwd()+"/test/test.txt"), {name:'test.txt', chunkSize:1048576})
        await folderSystem.createFolder("subfolder-test-3")
        await folderSystem.changeDirectory("subfolder-test-3", true)
        await folderSystem.uploadFile(fs.createReadStream(process.cwd()+"/test/test.txt"), {name:'test.txt', chunkSize:1048576})

        const zip: any = await folderSystem.downloadFolder("folder-test/subfolder-test", "nodebuffer")
        const readStream = Readable.from(zip)
        const writeStream = fs.createWriteStream(process.cwd()+"/test_output/test.zip")

        readStream.pipe(writeStream)

        await new Promise<void>((resolve)=>{
            writeStream.on("finish",()=>{
                resolve()
            })
        })

        await extract(process.cwd()+"/test_output/test.zip", {dir:process.cwd()+"/test_output"})

        expect(fs.readFileSync(process.cwd()+"/test_output/test.txt").equals(fs.readFileSync(process.cwd()+"/test/test.txt"))).to.be.equal(true)
        expect(fs.readFileSync(process.cwd()+"/test_output/test.PNG").equals(fs.readFileSync(process.cwd()+"/test/test.PNG"))).to.be.equal(true)
        expect(fs.readFileSync(process.cwd()+"/test_output/subfolder-test-2/test.txt").equals(fs.readFileSync(process.cwd()+"/test/test.txt"))).to.be.equal(true)
        expect(fs.readFileSync(process.cwd()+"/test_output/subfolder-test-2/subfolder-test-3/test.txt").equals(fs.readFileSync(process.cwd()+"/test/test.txt"))).to.be.equal(true)



        await folderSystem.changeDirectory("folder-test")
        await folderSystem.uploadFile(fs.createReadStream(process.cwd()+"/test/test.txt"), {name:"test.txt", chunkSize:1048576})
        const zip2: any = await folderSystem.downloadFolder("folder-test", "nodebuffer")
        const readStream2 = Readable.from(zip2)
        const writeStream2 = fs.createWriteStream(process.cwd()+"/test_output_2/whole-collection-test.zip")

        readStream2.pipe(writeStream2)

        await new Promise<void>((resolve)=>{
            writeStream2.on("finish",()=>{
                resolve()
            })
        })

        await extract(process.cwd()+"/test_output_2/whole-collection-test.zip", {dir:process.cwd()+"/test_output_2"})

        expect(fs.readFileSync(process.cwd()+"/test_output_2/subfolder-test/test.txt").equals(fs.readFileSync(process.cwd()+"/test/test.txt"))).to.be.equal(true)
        expect(fs.readFileSync(process.cwd()+"/test_output_2/test.txt").equals(fs.readFileSync(process.cwd()+"/test/test.txt"))).to.be.equal(true)
        expect(fs.readFileSync(process.cwd()+"/test_output_2/subfolder-test/test.PNG").equals(fs.readFileSync(process.cwd()+"/test/test.PNG"))).to.be.equal(true)
        expect(fs.readFileSync(process.cwd()+"/test_output_2/subfolder-test/subfolder-test-2/test.txt").equals(fs.readFileSync(process.cwd()+"/test/test.txt"))).to.be.equal(true)
        expect(fs.readFileSync(process.cwd()+"/test_output_2/subfolder-test/subfolder-test-2/subfolder-test-3/test.txt").equals(fs.readFileSync(process.cwd()+"/test/test.txt"))).to.be.equal(true)


        folderSystem.client.close()
    })

    it('should throw an error if the user tries to download a folder that does not exist', async ()=>{
        let err: any

        try{
            await folderSystem.downloadFolder("invalid-folder-path", "nodebuffer")
        }

        catch(e){
            err = e
        }

        expect(err.message).to.be.equal("Folder with path invalid-folder-path does not exist")
        folderSystem.client.close()
    })

    it('should throw an error if the user provides an invalid argument for returnType when trying to download a folder', async ()=>{
        let err: any

        try{
            // @ts-ignore
            await folderSystem.downloadFolder("folder-test", "wadw")
        }

        catch(e){
            err = e
        }

        expect(err.message).to.be.equal(`Invalid argument for parameter returnType. Argument must either be 'base64','nodebuffer', 'array', 'uint8array','arraybuffer', 'blob', or 'binarystring'.`)
        folderSystem.client.close()
    })

    it('should allow users to rename folders', async ()=>{
        await folderSystem.client.connect()
        await folderSystem.changeFolderName("new-folder-name", "folder-test/subfolder-test")
        expect(Boolean(await folderSystem.db.collection(folderCollectionName).findOne({"path":"folder-test/new-folder-name", "name":"new-folder-name"}))).to.be.equal(true)
        expect(Boolean(await folderSystem.db.collection(folderCollectionName).findOne({"path":"folder-test/new-folder-name/subfolder-test-2"}))).to.be.equal(true)
        expect(Boolean(await folderSystem.db.collection(folderCollectionName).findOne({"path":"folder-test/new-folder-name/subfolder-test-2/subfolder-test-3"}))).to.be.equal(true)
        expect(await folderSystem.db.collection(bucketName+".files").find({"metadata.path":"folder-test/new-folder-name/test.txt"}).hasNext()).to.be.equal(true)
        expect(await folderSystem.db.collection(bucketName+".files").find({"metadata.path":"folder-test/new-folder-name/test.PNG"}).hasNext()).to.be.equal(true)
        expect(await folderSystem.db.collection(bucketName+".files").find({"metadata.path":"folder-test/new-folder-name/subfolder-test-2/test.txt"}).hasNext()).to.be.equal(true)
        expect(await folderSystem.db.collection(bucketName+".files").find({"metadata.path":"folder-test/new-folder-name/subfolder-test-2/subfolder-test-3/test.txt"}).hasNext()).to.be.equal(true)
        folderSystem.client.close()
    })

    it('should throw an error if the user tries to change the name of a folder that does not exist, the new folder name contains invalid characters, a folder with the new name already exists in the specified directory, or the user attempts to rename the root directory', async ()=>{
        await folderSystem.client.connect()
        let err: any

        try{
            await folderSystem.changeFolderName("new-file-name.txt", "invalid-path")
        }

        catch(e: any){
            err = e
        }

        expect(err.message).to.be.equal("Folder with path invalid-path does not exist")
        err = undefined

        try{
            await folderSystem.changeFolderName("invalid-name$", "folder-test/new-folder-name")
        }

        catch(e: any){
            err = e
        }

        expect(err.message).to.be.equal(`Character "$" cannot be used as part of a folder name`)
        err = undefined

        try{
            await folderSystem.changeFolderName("new-root-name", "folder-test")
        }

        catch(e: any){
            err = e
        }

        expect(err.message).to.be.equal("Cannot rename root directory of the file tree")

        err = undefined

        try{
            await folderSystem.changeFolderName("new-folder-name", "folder-test/new-folder-name")
        }

        catch(e: any){
            err = e
        }

        expect(err.message).to.be.equal("Folder with name new-folder-name already exists in the specified directory")
        folderSystem.client.close()
    })

    it('should allow users to delete folders', async ()=>{
        await folderSystem.client.connect()

        await folderSystem.deleteFolder("folder-test/new-folder-name")
        expect(Boolean(await folderSystem.db.collection(folderCollectionName).findOne({"path":"folder-test/new-folder-name"}))).to.be.equal(false)
        expect(Boolean(await folderSystem.db.collection(folderCollectionName).findOne({"path":"folder-test/new-folder-name/subfolder-test-2"}))).to.be.equal(false)
        expect(Boolean(await folderSystem.db.collection(folderCollectionName).findOne({"path":"folder-test/new-folder-name/subfolder-test-2/subfolder-test-3"}))).to.be.equal(false)
        expect(await folderSystem.db.collection(bucketName+".files").find({"metadata.path":"folder-test/new-folder-name/test.txt"}).hasNext()).to.be.equal(false)
        expect(await folderSystem.db.collection(bucketName+".files").find({"metadata.path":"folder-test/new-folder-name/test.PNG"}).hasNext()).to.be.equal(false)
        expect(await folderSystem.db.collection(bucketName+".files").find({"metadata.path":"folder-test/new-folder-name/subfolder-test-2/test.txt"}).hasNext()).to.be.equal(false)
        expect(await folderSystem.db.collection(bucketName+".files").find({"metadata.path":"folder-test/new-folder-name/subfolder-test-2/subfolder-test-3/test.txt"}).hasNext()).to.be.equal(false)

        await folderSystem.createFolder("new-folder")
        await folderSystem.deleteFolder("folder-test")
        expect(Boolean(await folderSystem.db.collection(folderCollectionName).findOne({"parentDirectory":new RegExp("^"+folderCollectionName)}))).to.be.equal(false)
        expect(Boolean(await folderSystem.bucket.find({"metadata.parentDirectory":new RegExp("^"+folderCollectionName)}).hasNext())).to.be.equal(false)
        folderSystem.client.close()
    })

    it('should throw an error if the user tries to delete a folder that does not exist', async ()=>{
        let err: any

        try{
            await folderSystem.deleteFolder("invalid-folder-path")
        }

        catch(e){
            err = e
        }

        expect(err.message).to.be.equal("Folder with path invalid-folder-path does not exist")

        folderSystem.client.close()
    })

    it('should throw an error if the user tries to delete the current working directory', async ()=>{

        await folderSystem.createFolder("new-folder")

        await folderSystem.changeDirectory("new-folder", true)
        let err: any

        try{
            await folderSystem.deleteFolder("new-folder")
        }

        catch(e){
            err = e
        }

        expect(err.message).to.be.equal("Cannot delete current working directory (folder-test/new-folder)")

        folderSystem.client.close()
    })
})