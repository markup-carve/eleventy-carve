import carvePlugin from '@markup-carve/carve-components'

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(carvePlugin)

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
