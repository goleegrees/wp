import fs from "fs/promises"
import { tmpdir } from "os"
import { join as pathJoin } from "path"
import { createHash, randomUUID } from "node:crypto"
import { createServer } from "http"

let separator = "/"
if (process.platform === "win32") {
    separator = "\\"
}

const rdOpts = {
    recursive: true
}

if (process.argv.length === 4) {
    let rootContentPath = process.argv[2]
    let rootOutPath = process.argv[3]

    createServer(async (req, res) => {
        try {
            let url = req.url
            let fileEndingMatch = url.match(/\.(css|html)$/)
            if (!fileEndingMatch) {
                url += (url.charAt(url.length - 1) === "/" ? "" : "/") + "index.html"
            }
            let data = await fs.readFile(rootOutPath + url)
    
            let contentType = "text/html"
            fileEndingMatch = url.match(/\.(css|html)$/)
            if (fileEndingMatch && fileEndingMatch[1] === "css") {
                contentType = "text/css"
            }
            res.writeHead(200, { "Content-Type": contentType });
            res.end(data);
        } catch (err) {
            res.writeHead(404);
            res.end("Not found");
        }
    }).listen(8000)
    
    while (true) {
        console.log("Rebuilding everything.")

        // Save potential .git folder before deleting everything
        let gotGitFolder = true
        let tempFolderName = randomUUID()
        let tempFolderPath = pathJoin(tmpdir(), tempFolderName)
        try {
            await fs.cp(pathJoin(rootOutPath, ".git"), tempFolderPath, { recursive: true })
        } catch (err) {
            if (err.code === "ENOENT") {
                gotGitFolder = false
            } else {
                throw err
            }
        }
    
        try {
            await fs.rm(rootOutPath, { recursive: true })
        } catch (err) {
            if (err.code !== "ENOENT") {
                throw err
            }
        }
        await fs.mkdir(rootOutPath)

        // Restore .git folder
        if (gotGitFolder) {
            await fs.cp(tempFolderPath, pathJoin(rootOutPath, ".git"), { recursive: true })
        }
    
        let nav = []
        for (const shortFilePath of await fs.readdir(rootContentPath, rdOpts)) {
            if (shortFilePath.includes(separator) && shortFilePath.indexOf("_index") === -1) {
                let parts = shortFilePath.split(separator)
                let subjectName = parts[0]
                let itemName = parts[1]?.replace(".md", "")
        
                let navItem = nav.find(x => x.subject === subjectName)
                if (!navItem) {
                    navItem = {
                        subject: subjectName,
                        items: []
                    }
                    nav.push(navItem)
                }
                navItem.items.push(itemName)
            }
        }
        nav.forEach(navItem => navItem.items.sort())
        nav.sort((a,b) => a.subject.localeCompare(b.subject))
        let htmlMainNav = '<section class="main-nav"><details><summary>Innehåll</summary>' + nav.reduce((html, navItem) => {
            let contentTypeSlug = navItem.subject.replace(/ /g, "-")
                .toLowerCase()
                .replace(/[åä]/,"a")
                .replace(/[ö]/,"o")
            html += '<section class="main-nav__content-type">'
            html += '  <details>'
            html += '    <summary><a href="/' + contentTypeSlug + '">' + navItem.subject + '</a></summary>'
            for (const pageItemName of navItem.items) {
                let nameSlug = pageItemName.replace(/ /g, "-")
                    .toLowerCase()
                    .replace(/[åä]/,"a")
                    .replace(/[ö]/,"o")
                html += '    <section class="main-nav__content-item">'
                html += '      <a href="/' + contentTypeSlug + '/' + nameSlug + '">' + pageItemName + '</a>'
                html += '    </section>'
            }
            html += '  </details>'
            html += '</section>'
            return html
        },"") + '</details></section>'
    
        let cacheBusting = {}
        for (const filePath of await fs.readdir("source", rdOpts)) {
            let sourceMatch = filePath.match(/^(?:(.*)\/)?([^/]+)\.(css|js)$/)
            if (sourceMatch) {
                let path = sourceMatch[1] || ""
                let filename = sourceMatch[2]
                let extension = sourceMatch[3]
    
                let pathSlug = path
                    .replace(/ /g, "-")
                    .toLowerCase()
                    .replace(/[åä]/,"a")
                    .replace(/[ö]/,"o")
    
                // Files that should be copied as they are, possible with cache busting
                let srcFilePath = pathJoin(...["source", path, filename + "." + extension].filter(x => x.trim()))
                let outPath = pathJoin(...[rootOutPath, pathSlug].filter(x => x.trim()))
                await fs.mkdir(outPath, { recursive: true })
                let textData = await fs.readFile(srcFilePath, "utf-8")
                let finalFilename = filename
                let hash = createHash("sha256")
                hash.update(textData)
                let key = hash.digest("hex").slice(0,12)
                if (!cacheBusting[pathSlug]) {
                    cacheBusting[pathSlug] = {}
                }
                finalFilename = filename + "." + key
                cacheBusting[pathSlug][filename + "." + extension] = finalFilename + "." + extension
                let outFilePath = pathJoin(...[rootOutPath, pathSlug, finalFilename + "." + extension].filter(x => x.trim()))
    
                await fs.writeFile(outFilePath, textData)
            }
        }
    
        let templates = {}
        for (const filePath of await fs.readdir("source", rdOpts)) {
            let sourceMatch = filePath.match(/^(?:(.*)\/)?([^/]+)\.(html)$/)
            if (sourceMatch) {
                let path = sourceMatch[1] || ""
                let filename = sourceMatch[2]
                let extension = sourceMatch[3]
    
                let pathSlug = path
                    .replace(/ /g, "-")
                    .toLowerCase()
                    .replace(/[åä]/,"a")
                    .replace(/[ö]/,"o")
    
                // Files that should be copied almost as they are, possible with cache busting
                let srcFilePath = pathJoin(...["source", path, filename + "." + extension].filter(x => x.trim()))
                let outPath = pathJoin(...[rootOutPath, pathSlug].filter(x => x.trim()))
                await fs.mkdir(outPath, { recursive: true })
                let textData = await fs.readFile(srcFilePath, "utf-8")
                let finalFilename = filename
                let busted = cacheBusting[pathSlug]
                if (busted) {
                    for (const name of Object.keys(busted)) {
                        textData = textData.replace(new RegExp('"' + name + '"', "g"), busted[name])
                        textData = textData.replace(new RegExp('"/' + [pathSlug,name].filter(x => x.trim()).join("/") + '"', "g"), "/" + [pathSlug,busted[name]].filter(x => x.trim()).join("/"))
                    }
                }
    
                textData = textData
                    .replace(/{{main-nav}}/g, htmlMainNav)
    
                let outFilePath = pathJoin(...[rootOutPath, pathSlug, finalFilename + "." + extension].filter(x => x.trim()))
    
                if (filename.charAt(0) !== "_") {
                    await fs.writeFile(outFilePath, textData)
                } else {
                    templates[filename + "." + extension] = textData
                }
            }
        }

        let allContent = {}
        let contentPerType = {}
        for (const shortFilePath of await fs.readdir(rootContentPath, rdOpts)) {
            let contentMatch = shortFilePath.match(/^(.*)\/([^/]+)\.md$/)
            if (contentMatch) {
                let contentType = contentMatch[1]
                let contentTypeSlug = contentType
                    .replace(/ /g, "-")
                    .toLowerCase()
                    .replace(/[åä]/,"a")
                    .replace(/[ö]/,"o")
                let name = contentMatch[2]
                let nameSlug = name
                    .replace(/ /g, "-")
                    .toLowerCase()
                    .replace(/[åä]/,"a")
                    .replace(/[ö]/,"o")
    
                let filePath = pathJoin(...[rootContentPath, shortFilePath].map(x => x.trim()))
                let content = await fs.readFile(filePath, "utf-8")
                
                let contentParts = content.split("+++").map(x => x.trim()).filter(x => x)
                let settings = contentParts[0]
                    .split(/[\r\n|\n|\r]/)
                    .filter(x => x.trim())
                    .map(row => row.match(/^(.*?)=(.*)$/))
                    .reduce((acc, match) => {
                        acc[match[1].trim()] = match[2].trim()
                            .replace(/^['"]/g, "")
                            .replace(/['"]$/g, "")
                        return acc
                    },{})

                let contentItem = {
                    contentType,
                    contentTypeSlug,
                    name,
                    nameSlug,
                    settings,
                    data: contentParts[1]
                }
                allContent[shortFilePath] = contentItem

                if (!contentPerType[contentTypeSlug]) {
                    contentPerType[contentTypeSlug] = []
                }
                contentPerType[contentTypeSlug].push(contentItem)
            }
        }
    
        for (const shortFilePath of await fs.readdir(rootContentPath, rdOpts)) {
            let contentItem = allContent[shortFilePath]
            if (contentItem) {
                let contentRows = contentItem.data
                    .split(/[\r\n|\n|\r]/)
                    .filter(x => x.trim())
                    .map(x => x.trim())
                let htmlContent = contentRows
                    .map(row => row
                        .replace(/##### (.*)$/, "<h5>$1</h5>")
                        .replace(/#### (.*)$/, "<h4>$1</h4>")
                        .replace(/### (.*)$/, "<h3>$1</h3>")
                        .replace(/## (.*)$/, "<h2>$1</h2>")
                        .replace(/# (.*)$/, "<h1>$1</h1>")
                        .replace(/\*\*\*(.*)\*\*\*/, "<strong><em>$1</em></strong>")
                        .replace(/\*\*(.*)\*\*/, "<strong>$1</strong>")
                        .replace(/\*(.*)\*/, "<em>$1</em>")
                        .replace(/!\[(.+?)\]\((.+?)(?: "?(.+?)"?)?\)/, '<img class="inline-image" src="$2" alt="$1" title="$3">')
                        .replace(/\[(.+?)\]\((.+?)\)/, '<a href="$2">$1</a>')
                        .replace(/>(.*)/, "<blockquote><p>$1</p></blockquote>")
                        .replace(/^([^<].*)$/, "<p>$1</p>"))
                    .join("\n")
                        .replace(/<\/blockquote>\n<blockquote>/gs, "")
    
                let contentTemplate = templates["_default-content.html"]
                if (contentItem.name.indexOf("_index") === 0) {
                    contentTemplate = templates["_default-index.html"]
                }

                let htmlBreadcrumbs = `<section class="breadcrumbs"><a href="/">Hjelmsby och Hjelmsberg</a> | ${contentItem.contentType}</section>`
                if (contentItem.name.indexOf("_index") !== 0) {
                    htmlBreadcrumbs = `<section class="breadcrumbs"><a href="/">Hjelmsby och Hjelmsberg</a> | <a href="/${contentItem.contentTypeSlug}">${contentItem.contentType}</a> | ${contentItem.name}</section>`
                }

                let htmlContentIndex = ""
                if (contentItem.name.indexOf("_index") === 0) {
                    let collection = contentPerType[contentItem.contentTypeSlug]
                    if (collection) {
                        htmlContentIndex += "<section>"
                        for (const indexItem of collection.filter(x => x.name !== "_index")) {
                            htmlContent += `  <a class="index-card__link-container" href="/${indexItem.contentTypeSlug}/${indexItem.nameSlug}">`
                            htmlContent += '    <section class="index-card">'
                            htmlContent += `      <img class="inline-image" src="${indexItem.settings.featured_image}">`
                            htmlContent += `      <h3>${indexItem.settings.title}</h3>`
                            htmlContent += "    </section>"
                            htmlContent += "  </a>"
                        }
                        htmlContentIndex += "</section>"
                    }
                }

                let featuredImageHtml = `<img class="banner-image" src="${contentItem.settings.featured_image}" alt="${contentItem.settings.featured_image_alt}">`
                if (contentItem.settings.featured_image_narrow) {
                    featuredImageHtml = ""
                    featuredImageHtml += '<section class="banner-image__container">'
                    featuredImageHtml += '  <picture>'
                    featuredImageHtml += `    <source media="(max-width: 799px)" srcset="${contentItem.settings.featured_image_narrow}" />`
                    featuredImageHtml += `    <source media="(min-width: 800px)" srcset="${contentItem.settings.featured_image}" />`
                    featuredImageHtml += `    <img class="banner-image" src="${contentItem.settings.featured_image}" alt="${contentItem.settings.featured_image_alt}">`
                    featuredImageHtml += '  </picture>'
                    featuredImageHtml += '</section>'
                }

                let html = contentTemplate
                    .replace(/{{title}}/g, contentItem.settings.title)
                    .replace(/{{featured_image}}/g, featuredImageHtml)
                    .replace(/{{content}}/g, htmlContent)
                    .replace(/{{main-nav}}/g, htmlMainNav)
                    .replace(/{{breadcrumbs}}/g, htmlBreadcrumbs)
                    .replace(/{{content-index}}/g, htmlContentIndex)
    
                let outPath = pathJoin(...[rootOutPath, contentItem.contentTypeSlug, contentItem.nameSlug].map(x => x.trim()))
                let outFilePath = pathJoin(...[rootOutPath, contentItem.contentTypeSlug, contentItem.nameSlug, "index.html"].map(x => x.trim()))
                if (contentItem.name.indexOf("_index") === 0) {
                    outFilePath = pathJoin(...[rootOutPath, contentItem.contentTypeSlug, "index.html"].map(x => x.trim()))
                } else {
                    await fs.mkdir(outPath, { recursive: true })
                }
                await fs.writeFile(outFilePath, html)
            }
        }
    
        console.log("Done")
    
        console.log("Waiting 10 seconds until next rebuild...")
    
        await new Promise(r => setTimeout(r, 10 * 1000))
    }
} else {
    console.error("Det saknas sökvägar för katalog att hämta från och lägga saker i!")
}