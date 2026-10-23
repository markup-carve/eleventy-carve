import carvePlugin from '@markup-carve/eleventy-carve'

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(carvePlugin, { wikilinks: true })

  return {
    dir: {
      input: 'input',
      output: '_site',
      includes: '_includes',
    },
    // Allow .crv files to be processed as templates.
    templateFormats: ['crv'],
  }
}
